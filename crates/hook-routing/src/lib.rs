//! Canonical dynamic hook routing for the single-quota initial profile.
//! The quota pointer is zero between operations. Only the guard-authorized arm
//! may install it, and successful native hook consumption must clear it.
use solana_pubkey::Pubkey;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, pubkey_data::PubkeyData, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::{
    get_extra_account_metas_address, instruction::ExecuteInstruction,
};

pub const QUOTA_LEN: usize = 161;
pub const ACTIVE_PERMIT_OFFSET: usize = 129;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoutingError {
    Owner,
    Address,
    Schema,
}

pub fn canonical_metadata(quota: &[u8; 32]) -> Result<Vec<u8>, RoutingError> {
    let entries = [
        ExtraAccountMeta::new_with_pubkey(&Pubkey::new_from_array(*quota), false, true)
            .map_err(|_| RoutingError::Schema)?,
        ExtraAccountMeta::new_with_pubkey_data(
            &PubkeyData::AccountData {
                account_index: 5,
                data_index: ACTIVE_PERMIT_OFFSET as u8,
            },
            false,
            true,
        )
        .map_err(|_| RoutingError::Schema)?,
    ];
    let mut data =
        vec![0; ExtraAccountMetaList::size_of(entries.len()).map_err(|_| RoutingError::Schema)?];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &entries)
        .map_err(|_| RoutingError::Schema)?;
    Ok(data)
}

pub fn validate_metadata(
    mint: &[u8; 32],
    quota: &[u8; 32],
    hook: &[u8; 32],
    metadata_key: &[u8; 32],
    metadata_owner: &[u8; 32],
    data: &[u8],
) -> Result<(), RoutingError> {
    if metadata_owner != hook {
        return Err(RoutingError::Owner);
    }
    let expected = get_extra_account_metas_address(
        &Pubkey::new_from_array(*mint),
        &Pubkey::new_from_array(*hook),
    );
    if expected.to_bytes() != *metadata_key {
        return Err(RoutingError::Address);
    }
    if data != canonical_metadata(quota)? {
        return Err(RoutingError::Schema);
    }
    Ok(())
}
