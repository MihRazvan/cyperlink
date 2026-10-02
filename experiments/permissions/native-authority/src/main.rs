//! Local SVM only: native ELF/proof execution with synthetic token accounts.
//! No transaction signature verification, provisioning, validator, or MPC claim.
use cyperlink_client_proofs::{prepare_transfer, ClientKeys, TransferAddresses};
use mollusk_svm::{program::loader_keys::LOADER_V3, Mollusk};
use serde_json::{json, Value};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::{ConfidentialTransferAccount, ConfidentialTransferMint},
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState, Mint},
};
fn key(n: u8) -> Address {
    Address::new_from_array([n; 32])
}
fn account(owner: Address, data: Vec<u8>) -> Account {
    Account {
        lamports: 100_000_000,
        owner,
        data,
        executable: false,
        rent_epoch: 0,
    }
}
fn mint_data() -> Vec<u8> {
    let mut data = vec![
        0;
        ExtensionType::try_calculate_account_len::<Mint>(&[
            ExtensionType::ConfidentialTransferMint
        ])
        .unwrap()
    ];
    let mut s = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
    s.init_extension::<ConfidentialTransferMint>(true)
        .unwrap()
        .auto_approve_new_accounts = true.into();
    s.base = Mint {
        mint_authority: None.into(),
        supply: 100,
        decimals: 0,
        is_initialized: true,
        freeze_authority: None.into(),
    };
    s.pack_base();
    s.init_account_type().unwrap();
    data
}
fn token_data(mint: Address, owner: Address, keys: &ClientKeys, balance: u64) -> Vec<u8> {
    let mut data = vec![
        0;
        ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::ConfidentialTransferAccount
        ])
        .unwrap()
    ];
    let mut s = StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut data).unwrap();
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
    s.base = TokenAccount {
        mint,
        owner,
        amount: 0,
        delegate: None.into(),
        state: AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    };
    s.pack_base();
    s.init_account_type().unwrap();
    data
}
fn instruction(v: &Value) -> Instruction {
    Instruction {
        program_id: v["program"].as_str().unwrap().parse().unwrap(),
        data: hex::decode(v["data"].as_str().unwrap()).unwrap(),
        accounts: v["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| AccountMeta {
                pubkey: a["key"].as_str().unwrap().parse().unwrap(),
                is_signer: a["signer"].as_bool().unwrap(),
                is_writable: a["writable"].as_bool().unwrap(),
            })
            .collect(),
    }
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "usage: probe TOKEN_ELF REPORT_JSON");
    let elf = std::fs::read(&args[1]).unwrap();
    let elf_hash = hex::encode(solana_sha256_hasher::hash(&elf).to_bytes());
    assert_eq!(
        elf_hash,
        "0999dbf708971e723b08d1caafc988826a59c6001ed6dc02260da07defbe1469"
    );
    let mut svm = Mollusk::default();
    svm.compute_budget.compute_unit_limit = 1_400_000;
    let token = spl_token_2022_interface::id();
    let zk = solana_zk_elgamal_proof_interface::id();
    svm.add_program_with_loader_and_elf(&token, &LOADER_V3, &elf);
    let a = TransferAddresses {
        source: key(1),
        mint: key(2),
        destination: key(3),
        owner: key(4),
        equality: key(5),
        grouped: key(6),
        range: key(7),
    };
    let delegate = key(8);
    let keys = ClientKeys::generate();
    let dest_keys = ClientKeys::generate();
    let source_data = token_data(a.mint, a.owner, &keys, 100);
    let prepared = prepare_transfer(
        &keys,
        &source_data,
        60,
        &a,
        dest_keys.elgamal().pubkey(),
        None,
    )
    .unwrap();
    let mut accounts = vec![
        (a.source, account(token, source_data)),
        (a.mint, account(token, mint_data())),
        (
            a.destination,
            account(token, token_data(a.mint, key(9), &dest_keys, 0)),
        ),
        (a.owner, account(Address::default(), vec![])),
        (delegate, account(Address::default(), vec![])),
    ];
    let mut proof_results = vec![];
    for p in prepared.public["proofs"].as_array().unwrap() {
        let addr = p["context_address"].as_str().unwrap().parse().unwrap();
        accounts.push((
            addr,
            account(
                zk,
                vec![0; p["context_account_size"].as_u64().unwrap() as usize],
            ),
        ));
        let result = svm.process_instruction(&instruction(&p["verify_instruction"]), &accounts);
        assert!(result.program_result.is_ok(), "{:?}", result.program_result);
        proof_results.push(json!({"proof":p["name"],"native_verified":true,"compute_units":result.compute_units_consumed}));
        accounts = result.resulting_accounts;
    }
    // Genuine native Approve writes the delegate; don't inject a delegated account.
    let approve = spl_token_2022_interface::instruction::approve(
        &token,
        &a.source,
        &delegate,
        &a.owner,
        &[],
        100,
    )
    .unwrap();
    let result = svm.process_instruction(&approve, &accounts);
    assert!(result.program_result.is_ok());
    accounts = result.resulting_accounts;
    let honest = instruction(&prepared.public["native_instruction"]);
    let control = svm.process_instruction(&honest, &accounts);
    assert!(
        control.program_result.is_ok(),
        "owner control {:?}",
        control.program_result
    );
    let mut delegated = honest.clone();
    assert_eq!(delegated.accounts[6].pubkey, a.owner);
    delegated.accounts[6].pubkey = delegate;
    let denied = svm.process_instruction(&delegated, &accounts);
    assert_eq!(format!("{:?}", denied.program_result), "Failure(Custom(4))"); // OwnerMismatch
    assert_eq!(
        denied.resulting_accounts, accounts,
        "delegate rejection must preserve all state"
    );
    let mut unsigned = honest.clone();
    unsigned.accounts[6].is_signer = false;
    let absent = svm.process_instruction(&unsigned, &accounts);
    assert!(absent.program_result.is_err());
    assert_eq!(absent.resulting_accounts, accounts);
    let report = json!({"schema_version":1,"passed":true,"evidence_level":"local-svm-native-elf","token_elf_sha256":elf_hash,
        "mollusk":"0.13.4","sdk":"7.0.1","fresh_proofs":proof_results,
        "native_approve_succeeded":true,"owner_authorized_control_succeeded":true,
        "delegate_with_genuine_proofs":{"error":format!("{:?}",denied.program_result),"rollback":true},
        "owner_without_signer_privilege":{"error":format!("{:?}",absent.program_result),"rollback":true},
        "test_observer_disclosures":{"initial_synthetic_balance":100,"attempted_amount":60},
        "limitations":["Synthetic token/mint accounts; contexts created only through actual native verification","Mollusk signer privileges are provided, not Ed25519 transactions","No local validator, distributed computation, grants, or successful delegated execution"]});
    use std::io::Write;
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args[2])
        .unwrap();
    out.write_all(serde_json::to_string_pretty(&report).unwrap().as_bytes())
        .unwrap();
    println!("Native owner control passes; actual native Approve delegate fails OwnerMismatch with verified fresh proofs; report {}",args[2]);
}
