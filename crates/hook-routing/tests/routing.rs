//! Host resolver tests only: these do not establish captured Token-2022 ELF
//! compatibility. The real validator replay must qualify that independently.
use cyperlink_hook_routing::{
    canonical_metadata, validate_metadata, RoutingError as E, ACTIVE_PERMIT_OFFSET, QUOTA_LEN,
};
use solana_pubkey::Pubkey;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, pubkey_data::PubkeyData, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::{
    get_extra_account_metas_address,
    instruction::{execute, ExecuteInstruction},
};
const MINT: [u8; 32] = [20; 32];
const Q: [u8; 32] = [61; 32];
const H: [u8; 32] = [82; 32];
fn metadata_key() -> [u8; 32] {
    get_extra_account_metas_address(&Pubkey::new_from_array(MINT), &Pubkey::new_from_array(H))
        .to_bytes()
}
fn check(data: &[u8]) -> Result<(), E> {
    validate_metadata(&MINT, &Q, &H, &metadata_key(), &H, data)
}
fn encode(entries: &[ExtraAccountMeta]) -> Vec<u8> {
    let mut data = vec![0; ExtraAccountMetaList::size_of(entries.len()).unwrap()];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, entries).unwrap();
    data
}

#[test]
fn canonical_schema_and_metadata_identity() {
    let data = canonical_metadata(&Q).unwrap();
    assert_eq!(data.len(), 86);
    assert_eq!(check(&data), Ok(()));
    assert_eq!(
        validate_metadata(&MINT, &Q, &H, &metadata_key(), &[0; 32], &data),
        Err(E::Owner)
    );
    assert_eq!(
        validate_metadata(&MINT, &Q, &H, &[9; 32], &H, &data),
        Err(E::Address)
    );
    assert_eq!(
        validate_metadata(&[21; 32], &Q, &H, &metadata_key(), &H, &data),
        Err(E::Address)
    );
    assert_eq!(
        validate_metadata(&MINT, &[60; 32], &H, &metadata_key(), &H, &data),
        Err(E::Schema)
    );
}

#[test]
fn every_byte_and_trailing_data_are_bound() {
    let data = canonical_metadata(&Q).unwrap();
    for i in 0..data.len() {
        let mut changed = data.clone();
        changed[i] ^= 1;
        assert_eq!(check(&changed), Err(E::Schema), "byte {i}");
    }
    let mut changed = data.clone();
    changed.push(0);
    assert_eq!(check(&changed), Err(E::Schema));
    assert_eq!(check(&data[..data.len() - 1]), Err(E::Schema));
}

#[test]
fn alternate_offsets_flags_static_permits_and_extra_metas_rejected() {
    let quota = ExtraAccountMeta::new_with_pubkey(&Pubkey::new_from_array(Q), false, true).unwrap();
    for (account_index, data_index, signer, writable) in [
        (6, 129, false, true),
        (5, 128, false, true),
        (5, 129, true, true),
        (5, 129, false, false),
    ] {
        let dynamic = ExtraAccountMeta::new_with_pubkey_data(
            &PubkeyData::AccountData {
                account_index,
                data_index,
            },
            signer,
            writable,
        )
        .unwrap();
        assert_eq!(check(&encode(&[quota, dynamic])), Err(E::Schema));
    }
    let fixed =
        ExtraAccountMeta::new_with_pubkey(&Pubkey::new_from_array([8; 32]), false, true).unwrap();
    assert_eq!(check(&encode(&[quota, fixed])), Err(E::Schema));
    let dynamic = ExtraAccountMeta::new_with_pubkey_data(
        &PubkeyData::AccountData {
            account_index: 5,
            data_index: 129,
        },
        false,
        true,
    )
    .unwrap();
    assert_eq!(check(&encode(&[quota, dynamic, fixed])), Err(E::Schema));
    let readonly_quota =
        ExtraAccountMeta::new_with_pubkey(&Pubkey::new_from_array(Q), false, false).unwrap();
    assert_eq!(check(&encode(&[readonly_quota, dynamic])), Err(E::Schema));
}

#[test]
fn upstream_cpi_resolver_reads_the_current_armed_quota_pointer() {
    use solana_account_info::AccountInfo;
    let hook = Pubkey::new_from_array(H);
    let mint = Pubkey::new_from_array(MINT);
    let source = Pubkey::new_from_array([10; 32]);
    let dest = Pubkey::new_from_array([30; 32]);
    let owner = Pubkey::new_from_array([40; 32]);
    let quota = Pubkey::new_from_array(Q);
    let meta = Pubkey::new_from_array(metadata_key());
    for (selected, provided, accepted) in [
        (90, 90, true),
        (91, 91, true),
        (90, 91, false),
        (0, 90, false),
    ] {
        let selected = [selected; 32];
        let permit = Pubkey::new_from_array([provided; 32]);
        let mut quota_data = vec![0; QUOTA_LEN];
        quota_data[ACTIVE_PERMIT_OFFSET..].copy_from_slice(&selected);
        let mut l = [0u64; 7];
        let [l0, l1, l2, l3, l4, l5, l6] = &mut l;
        let mut s = vec![];
        let mut m = vec![];
        let mut d = vec![];
        let mut o = vec![];
        let mut metadata = canonical_metadata(&Q).unwrap();
        let mut p = vec![0; 520];
        let infos = vec![
            AccountInfo::new(&source, false, true, l0, &mut s, &hook, false),
            AccountInfo::new(&mint, false, false, l1, &mut m, &hook, false),
            AccountInfo::new(&dest, false, true, l2, &mut d, &hook, false),
            AccountInfo::new(&owner, true, false, l3, &mut o, &hook, false),
            AccountInfo::new(&meta, false, false, l4, &mut metadata, &hook, false),
            AccountInfo::new(&quota, false, true, l5, &mut quota_data, &hook, false),
            AccountInfo::new(&permit, false, true, l6, &mut p, &hook, false),
        ];
        let mut ix = execute(&hook, &source, &mint, &dest, &owner, u64::MAX);
        ix.accounts
            .push(solana_instruction::AccountMeta::new_readonly(meta, false));
        let mut cpi = infos[..5].to_vec();
        let result = ExtraAccountMetaList::add_to_cpi_instruction::<ExecuteInstruction>(
            &mut ix,
            &mut cpi,
            &canonical_metadata(&Q).unwrap(),
            &infos[5..],
        );
        if !accepted {
            assert!(
                result.is_err(),
                "stale or idle pointer must not resolve supplied permit"
            );
            continue;
        }
        result.unwrap();
        assert_eq!(ix.accounts[5].pubkey, quota);
        assert_eq!(ix.accounts[6].pubkey, permit);
        assert!(ix.accounts[5].is_writable && ix.accounts[6].is_writable);
    }
}
