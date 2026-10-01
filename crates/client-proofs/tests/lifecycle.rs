//! Host proof/key lifecycle tests. Mutated account bytes below model state updates;
//! they do not establish native settlement or on-chain account ownership.
use cyperlink_client_proofs::*;
use solana_address::Address;
use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedGroupedCiphertext3HandlesValidityProofData, BatchedRangeProofU128Data,
    CiphertextCommitmentEqualityProofData, PubkeyValidityProofData,
};
use solana_zk_sdk::{
    encryption::{
        elgamal::ElGamalKeypair,
        pedersen::{Pedersen, PedersenOpening},
    },
    zk_elgamal_proof_program::VerifyZkProof,
};
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount, transfer_hook::TransferHookAccount,
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    state::{Account, AccountState},
};
use std::{
    os::unix::fs::{symlink, PermissionsExt},
    path::PathBuf,
};

fn addresses() -> TransferAddresses {
    let k = |n| Address::new_from_array([n; 32]);
    TransferAddresses {
        source: k(1),
        mint: k(2),
        destination: k(3),
        owner: k(4),
        equality: k(5),
        grouped: k(6),
        range: k(7),
    }
}
fn account(keys: &ClientKeys, balance: u64) -> Vec<u8> {
    let a = addresses();
    let mut bytes = vec![
        0;
        ExtensionType::try_calculate_account_len::<Account>(&[
            ExtensionType::ConfidentialTransferAccount,
            ExtensionType::TransferHookAccount
        ])
        .unwrap()
    ];
    let mut s = StateWithExtensionsMut::<Account>::unpack_uninitialized(&mut bytes).unwrap();
    let ct = s
        .init_extension::<ConfidentialTransferAccount>(true)
        .unwrap();
    ct.approved = true.into();
    ct.elgamal_pubkey = (*keys.elgamal().pubkey()).into();
    ct.available_balance = keys.elgamal().pubkey().encrypt(balance).into();
    ct.decryptable_available_balance = keys.aes().encrypt(balance).into();
    ct.allow_confidential_credits = true.into();
    ct.allow_non_confidential_credits = true.into();
    ct.maximum_pending_balance_credit_counter = 100u64.into();
    s.init_extension::<TransferHookAccount>(true).unwrap();
    s.base = Account {
        mint: a.mint,
        owner: a.owner,
        amount: 0,
        delegate: None.into(),
        state: AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    };
    s.pack_base();
    s.init_account_type().unwrap();
    bytes
}
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "cyperlink-client-proofs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

fn verify_public(p: &PreparedTransfer) {
    let proofs = &p.public["proofs"];
    macro_rules! check {
        ($i:expr,$t:ty) => {{
            let bytes = hex::decode(proofs[$i]["proof_data"].as_str().unwrap()).unwrap();
            bytemuck::pod_read_unaligned::<$t>(&bytes)
                .verify_proof()
                .unwrap();
        }};
    }
    check!(0, CiphertextCommitmentEqualityProofData);
    check!(1, BatchedGroupedCiphertext3HandlesValidityProofData);
    check!(2, BatchedRangeProofU128Data);
    let opening = PedersenOpening::from_bytes(p.witness.opening_bytes()).unwrap();
    assert_eq!(
        hex::encode(Pedersen::with(p.witness.amount(), &opening).to_bytes()),
        p.public["expected_commitment"]
    );
    assert!(p.public.get("amount").is_none());
    assert!(p.public.get("opening").is_none());
    assert!(p.public.get("aes_key").is_none());
    assert!(p.public.get("elgamal_keypair").is_none());
}

#[test]
fn persisted_keys_support_fresh_sixty_then_forty_proofs() {
    let temp = Temp::new();
    let path = temp.0.join("client.keys");
    let first_keys = ClientKeys::generate();
    first_keys.save_new(&path).unwrap();
    let first_pub = first_keys.public_key_hex();
    drop(first_keys);
    let keys = ClientKeys::load(&path).unwrap();
    assert_eq!(first_pub, keys.public_key_hex());
    let destination = ElGamalKeypair::new_rand();
    let mut bytes = account(&keys, 100);
    let first =
        prepare_transfer(&keys, &bytes, 60, &addresses(), destination.pubkey(), None).unwrap();
    verify_public(&first);
    let mut state = StateWithExtensionsMut::<Account>::unpack(&mut bytes).unwrap();
    let ct = state
        .get_extension_mut::<ConfidentialTransferAccount>()
        .unwrap();
    ct.available_balance.0.copy_from_slice(
        &hex::decode(
            first.public["expected_new_source_ciphertext"]
                .as_str()
                .unwrap(),
        )
        .unwrap(),
    );
    ct.decryptable_available_balance.0.copy_from_slice(
        &hex::decode(
            first.public["new_decryptable_available_balance"]
                .as_str()
                .unwrap(),
        )
        .unwrap(),
    );
    drop(keys);
    let keys = ClientKeys::load(&path).unwrap();
    assert!(prepare_transfer(&keys, &bytes, 41, &addresses(), destination.pubkey(), None).is_err());
    let second =
        prepare_transfer(&keys, &bytes, 40, &addresses(), destination.pubkey(), None).unwrap();
    verify_public(&second);
    assert_ne!(
        first.public["source_data_sha256"],
        second.public["source_data_sha256"]
    );
    assert_ne!(
        first.public["expected_commitment"],
        second.public["expected_commitment"]
    );
    let ae = solana_zk_sdk::encryption::auth_encryption::AeCiphertext::from_bytes(
        &hex::decode(
            second.public["new_decryptable_available_balance"]
                .as_str()
                .unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(keys.aes().decrypt(&ae), Some(0));
    let witness = temp.0.join("operation.witness");
    second.witness.save_new(&witness).unwrap();
    assert_eq!(
        std::fs::metadata(&witness).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(second.witness.save_new(&witness).is_err());
}

#[test]
fn private_key_storage_rejects_overwrite_public_permissions_and_symlinks() {
    let temp = Temp::new();
    let path = temp.0.join("client.keys");
    let keys = ClientKeys::generate();
    keys.save_new(&path).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(keys.save_new(&path).is_err());
    let link = temp.0.join("link.keys");
    symlink(&path, &link).unwrap();
    assert!(ClientKeys::load(&link).is_err());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(ClientKeys::load(&path).is_err());
}

#[test]
fn configure_proof_and_provision_plan_use_native_instruction_constructors() {
    let keys = ClientKeys::generate();
    let a = addresses();
    let plan = provision_plan(
        &keys,
        &a.source,
        &a.mint,
        &a.owner,
        &a.equality,
        &a.owner,
        &Address::new_from_array([82; 32]),
        100,
        0,
        100,
    )
    .unwrap();
    assert_eq!(plan["account_sizes"]["token"], 470);
    assert_eq!(plan["account_sizes"]["pubkey_context"], 65);
    assert_eq!(plan["mint_initialization"].as_array().unwrap().len(), 3);
    assert_eq!(plan["funding"].as_array().unwrap().len(), 3);
    let proof = hex::decode(plan["configuration"]["proof_data"].as_str().unwrap()).unwrap();
    bytemuck::pod_read_unaligned::<PubkeyValidityProofData>(&proof)
        .verify_proof()
        .unwrap();
    assert_eq!(
        plan["configuration"]["elgamal_pubkey"],
        keys.public_key_hex()
    );
}

#[test]
fn wrong_keys_owner_and_stale_decryptable_balance_fail() {
    let keys = ClientKeys::generate();
    let destination = ElGamalKeypair::new_rand();
    let mut bytes = account(&keys, 100);
    let wrong = ClientKeys::generate();
    assert!(
        prepare_transfer(&wrong, &bytes, 60, &addresses(), destination.pubkey(), None).is_err()
    );
    let mut a = addresses();
    a.owner = Address::new_from_array([99; 32]);
    assert!(prepare_transfer(&keys, &bytes, 60, &a, destination.pubkey(), None).is_err());
    for amount in [0, 101, 1u64 << 48] {
        assert!(prepare_transfer(
            &keys,
            &bytes,
            amount,
            &addresses(),
            destination.pubkey(),
            None
        )
        .is_err());
    }
    let mut state = StateWithExtensionsMut::<Account>::unpack(&mut bytes).unwrap();
    state
        .get_extension_mut::<ConfidentialTransferAccount>()
        .unwrap()
        .available_balance = keys.elgamal().pubkey().encrypt(90u64).into();
    assert!(prepare_transfer(&keys, &bytes, 60, &addresses(), destination.pubkey(), None).is_err());
}
