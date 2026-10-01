//! Host-only admission tests. Archived public proof bytes are cryptographically
//! reverified before their contexts are used. Account ownership/signature flags
//! here are scaffolding, not evidence of validator execution or authorization.
use cyperlink_native_admission::{validate, AccountView, AdmissionError as E, NoFeeAction};
use solana_address::Address;
use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedGroupedCiphertext3HandlesValidityProofData, BatchedRangeProofU128Data,
    CiphertextCommitmentEqualityProofData, ZkProofData,
};
use solana_zk_sdk::zk_elgamal_proof_program::VerifyZkProof;
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::{ConfidentialTransferAccount, ConfidentialTransferMint},
        cpi_guard::CpiGuard,
        transfer_fee::TransferFeeConfig,
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensions, BaseStateWithExtensionsMut, ExtensionType, StateWithExtensions,
        StateWithExtensionsMut,
    },
    state::{Account, AccountState, Mint},
};

#[derive(Clone)]
struct Owned {
    key: [u8; 32],
    owner: [u8; 32],
    data: Vec<u8>,
}
impl Owned {
    fn view(&self) -> AccountView<'_> {
        AccountView {
            key: &self.key,
            owner: &self.owner,
            data: &self.data,
        }
    }
}
#[derive(Clone)]
struct Fixture {
    accounts: [Owned; 6],
    instruction: Vec<u8>,
    owner: [u8; 32],
    commitment: [u8; 32],
    successor: [u8; 64],
}
const HOOK: [u8; 32] = [82; 32];
fn key(s: &str) -> [u8; 32] {
    s.parse::<Address>().unwrap().to_bytes()
}
impl Fixture {
    fn decode(raw: &str) -> Self {
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        let accounts = [
            "source",
            "mint",
            "destination",
            "equality",
            "grouped",
            "range",
        ]
        .map(|name| {
            let a = &v["accounts"][name];
            Owned {
                key: key(a["key"].as_str().unwrap()),
                owner: key(a["owner"].as_str().unwrap()),
                data: hex::decode(a["data"].as_str().unwrap()).unwrap(),
            }
        });
        // Reverify genuine proofs, then ensure the public account fixtures hold
        // precisely those verified contexts. No new proof contexts are invented.
        macro_rules! verified {
            ($i:expr,$t:ty) => {{
                let bytes = hex::decode(v["proof_instructions"][$i].as_str().unwrap()).unwrap();
                let proof = bytemuck::pod_read_unaligned::<$t>(&bytes[1..]);
                proof.verify_proof().unwrap();
                assert_eq!(
                    &accounts[$i + 3].data[33..],
                    bytemuck::bytes_of(proof.context_data())
                );
                proof
            }};
        }
        let eq = verified!(0, CiphertextCommitmentEqualityProofData);
        verified!(1, BatchedGroupedCiphertext3HandlesValidityProofData);
        verified!(2, BatchedRangeProofU128Data);
        Self {
            accounts,
            instruction: hex::decode(v["native_instruction"].as_str().unwrap()).unwrap(),
            owner: key(v["owner"].as_str().unwrap()),
            commitment: hex::decode(v["expected_commitment"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap(),
            successor: eq.context.ciphertext.0,
        }
    }
    fn action(&self) -> NoFeeAction<'_> {
        NoFeeAction {
            source: self.accounts[0].view(),
            mint: self.accounts[1].view(),
            destination: self.accounts[2].view(),
            equality: self.accounts[3].view(),
            grouped: self.accounts[4].view(),
            range: self.accounts[5].view(),
            owner: &self.owner,
            owner_signed: true,
            owner_account_owner: &[0; 32],
            owner_account_data_len: 0,
            native_instruction: &self.instruction,
            expected_hook: &HOOK,
            expected_commitment: &self.commitment,
            expected_new_source_ciphertext: &self.successor,
        }
    }
    fn result(&self) -> Result<cyperlink_native_admission::ValidatedAction, E> {
        validate(&self.action())
    }
    fn ct(&mut self, i: usize, f: impl FnOnce(&mut ConfidentialTransferAccount)) {
        let mut account =
            StateWithExtensionsMut::<Account>::unpack(&mut self.accounts[i].data).unwrap();
        f(account
            .get_extension_mut::<ConfidentialTransferAccount>()
            .unwrap());
    }
    fn base(&mut self, i: usize, f: impl FnOnce(&mut Account)) {
        let mut a = StateWithExtensionsMut::<Account>::unpack(&mut self.accounts[i].data).unwrap();
        f(&mut a.base);
        a.pack_base();
    }
}
fn fixtures() -> &'static [Fixture; 2] {
    static FIXTURES: std::sync::OnceLock<[Fixture; 2]> = std::sync::OnceLock::new();
    FIXTURES.get_or_init(|| {
        [
            Fixture::decode(include_str!("fixtures/a.json")),
            Fixture::decode(include_str!("fixtures/b.json")),
        ]
    })
}

#[test]
fn genuine_verified_native_transfers_pass() {
    for fixture in fixtures() {
        assert_eq!(
            fixture.result().unwrap().amount_commitment,
            fixture.commitment
        );
    }
}

#[test]
fn individually_verified_but_inconsistent_proof_sets_are_rejected() {
    let [a, b] = fixtures();
    for i in [3, 4, 5] {
        let mut mixed = a.clone();
        mixed.accounts[i] = b.accounts[i].clone();
        assert_eq!(
            mixed.result(),
            Err(E::ProofRelationship),
            "mixed component {i}"
        );
    }
}

#[test]
fn proof_account_ownership_shape_and_exact_type_are_checked() {
    for i in [3, 4, 5] {
        let mut a = fixtures()[0].clone();
        a.accounts[i].owner = [7; 32];
        assert_eq!(a.result(), Err(E::ProofOwner));
        let mut a = fixtures()[0].clone();
        a.accounts[i].data.pop();
        assert_eq!(a.result(), Err(E::ProofShape));
        let mut a = fixtures()[0].clone();
        a.accounts[i].data[32] = 0;
        assert_eq!(a.result(), Err(E::ProofType));
    }
}

#[test]
fn valid_proofs_do_not_authorize_a_different_current_balance() {
    let mut a = fixtures()[0].clone();
    let other = StateWithExtensions::<Account>::unpack(&fixtures()[1].accounts[0].data)
        .unwrap()
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap()
        .available_balance;
    a.ct(0, |ct| ct.available_balance = other);
    assert_eq!(a.result(), Err(E::Funding));
    let mut a = fixtures()[0].clone();
    a.ct(0, |ct| ct.available_balance.0 = [0; 64]);
    assert_eq!(a.result(), Err(E::Funding));
}

#[test]
fn source_destination_and_auditor_keys_are_bound() {
    for i in [0, 2] {
        let mut a = fixtures()[0].clone();
        a.ct(i, |ct| ct.elgamal_pubkey.0 = [0; 32]);
        assert_eq!(a.result(), Err(E::EncryptionKey));
    }
    let mut a = fixtures()[0].clone();
    let mut mint = StateWithExtensionsMut::<Mint>::unpack(&mut a.accounts[1].data).unwrap();
    mint.get_extension_mut::<ConfidentialTransferMint>()
        .unwrap()
        .auditor_elgamal_pubkey =
        solana_zk_sdk_pod::encryption::elgamal::PodElGamalPubkey([1; 32]).into();
    assert_eq!(a.result(), Err(E::EncryptionKey));
}

#[test]
fn native_instruction_and_auditor_ciphertexts_are_exact() {
    for i in [0, 1] {
        let mut a = fixtures()[0].clone();
        a.instruction[i] = 0;
        assert_eq!(a.result(), Err(E::Instruction));
    }
    for from_end in [1, 2, 3] {
        let mut a = fixtures()[0].clone();
        let i = a.instruction.len() - from_end;
        a.instruction[i] = 1;
        assert_eq!(a.result(), Err(E::Instruction));
    }
    let mut a = fixtures()[0].clone();
    a.instruction.push(0);
    assert_eq!(a.result(), Err(E::Instruction));
    let mut a = fixtures()[0].clone();
    a.instruction[38] ^= 1;
    assert_eq!(a.result(), Err(E::Auditor));
}

#[test]
fn expected_amount_and_post_transfer_source_are_bound() {
    let mut a = fixtures()[0].clone();
    a.commitment[0] ^= 1;
    assert_eq!(a.result(), Err(E::Commitment));
    let mut a = fixtures()[0].clone();
    a.successor[0] ^= 1;
    assert_eq!(a.result(), Err(E::Successor));
}

#[test]
fn canonical_token_owners_authority_and_mint_relationships_are_required() {
    for i in [0, 1, 2] {
        let mut a = fixtures()[0].clone();
        a.accounts[i].owner = [7; 32];
        assert_eq!(a.result(), Err(E::Owner));
    }
    let a = &fixtures()[0];
    let mut action = a.action();
    action.owner_signed = false;
    assert_eq!(validate(&action), Err(E::Owner));
    let mut action = a.action();
    let token_program = spl_token_2022_interface::id().to_bytes();
    action.owner_account_owner = &token_program;
    action.owner_account_data_len = 355; // Native multisig layout, even signed.
    assert_eq!(validate(&action), Err(E::Owner));
    let mut action = a.action();
    action.owner_account_data_len = 1;
    assert_eq!(validate(&action), Err(E::Owner));
    let mut a = fixtures()[0].clone();
    a.owner = [6; 32];
    assert_eq!(a.result(), Err(E::Owner));
    for i in [0, 2] {
        let mut a = fixtures()[0].clone();
        a.base(i, |b| b.mint = Address::new_from_array([7; 32]));
        assert_eq!(a.result(), Err(E::Account));
    }
    let mut a = fixtures()[0].clone();
    a.accounts[2].key = a.accounts[0].key;
    assert_eq!(a.result(), Err(E::Account));
}

#[test]
fn frozen_unapproved_and_saturated_destination_accounts_are_rejected() {
    for i in [0, 2] {
        let mut a = fixtures()[0].clone();
        a.base(i, |b| b.state = AccountState::Frozen);
        assert_eq!(a.result(), Err(E::Account));
    }
    let mut a = fixtures()[0].clone();
    a.ct(0, |ct| ct.approved = false.into());
    assert_eq!(a.result(), Err(E::Account));
    let mut a = fixtures()[0].clone();
    a.ct(2, |ct| ct.approved = false.into());
    assert_eq!(a.result(), Err(E::Destination));
    let mut a = fixtures()[0].clone();
    a.ct(2, |ct| ct.allow_confidential_credits = false.into());
    assert_eq!(a.result(), Err(E::Destination));
    let mut a = fixtures()[0].clone();
    a.ct(2, |ct| {
        ct.pending_balance_credit_counter = ct.maximum_pending_balance_credit_counter
    });
    assert_eq!(a.result(), Err(E::Destination));
    let mut a = fixtures()[0].clone();
    a.ct(2, |ct| ct.pending_balance_credit_counter = u64::MAX.into());
    assert_eq!(a.result(), Err(E::Destination));
    let mut a = fixtures()[0].clone();
    a.ct(2, |ct| ct.pending_balance_lo.0 = [255; 64]);
    assert_eq!(a.result(), Err(E::Destination));
}

#[test]
fn fee_extension_at_zero_bps_is_still_unsupported() {
    let mut a = fixtures()[0].clone();
    let len = ExtensionType::try_calculate_account_len::<Mint>(&[
        ExtensionType::ConfidentialTransferMint,
        ExtensionType::TransferHook,
        ExtensionType::TransferFeeConfig,
    ])
    .unwrap();
    a.accounts[1].data.resize(len, 0);
    StateWithExtensionsMut::<Mint>::unpack(&mut a.accounts[1].data)
        .unwrap()
        .init_extension::<TransferFeeConfig>(true)
        .unwrap();
    assert_eq!(a.result(), Err(E::UnsupportedProfile));
}

#[test]
fn cpi_guard_extension_is_outside_the_initial_allowlist() {
    let mut a = fixtures()[0].clone();
    let len = ExtensionType::try_calculate_account_len::<Account>(&[
        ExtensionType::ConfidentialTransferAccount,
        ExtensionType::TransferHookAccount,
        ExtensionType::CpiGuard,
    ])
    .unwrap();
    a.accounts[0].data.resize(len, 0);
    StateWithExtensionsMut::<Account>::unpack(&mut a.accounts[0].data)
        .unwrap()
        .init_extension::<CpiGuard>(true)
        .unwrap();
    assert_eq!(a.result(), Err(E::UnsupportedProfile));
}

#[test]
fn hook_configuration_and_transferring_flags_are_required() {
    let mut a = fixtures()[0].clone();
    StateWithExtensionsMut::<Mint>::unpack(&mut a.accounts[1].data)
        .unwrap()
        .get_extension_mut::<TransferHook>()
        .unwrap()
        .program_id = None.try_into().unwrap();
    assert_eq!(a.result(), Err(E::UnsupportedProfile));
    for i in [0, 2] {
        let mut a = fixtures()[0].clone();
        StateWithExtensionsMut::<Account>::unpack(&mut a.accounts[i].data)
            .unwrap()
            .get_extension_mut::<TransferHookAccount>()
            .unwrap()
            .transferring = true.into();
        assert_eq!(a.result(), Err(E::Account));
    }
}
