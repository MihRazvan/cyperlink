use cyperlink_hook_routing::{
    canonical_metadata, validate_metadata, ACTIVE_PERMIT_OFFSET,
};
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_clock::Clock;
use solana_program_entrypoint::{entrypoint, ProgramResult};
use solana_program_error::ProgramError;

use solana_sysvar::Sysvar;
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::{ConfidentialTransferAccount, ConfidentialTransferMint},
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    state::{Account, Mint},
};

entrypoint!(process);
mod deployment { include!("../../deployment.rs"); }
use deployment::*;
use cyperlink_custom_policy_layout::{STATE_LEN as QUOTA_LEN, PERMIT_LEN, STATE_IDENTITY, state_hash, valid_state, valid_permit};
fn identity() -> [u8;96] { cyperlink_custom_policy_layout::identity(&RELEASE_ID,&SCHEMA_ID,&DOMAIN_ID) }
const G: Address = Address::new_from_array(GUARD_ID);
const Q: Address = Address::new_from_array(QUOTA_ID);
fn e(n: u32) -> ProgramError {
    ProgramError::Custom(n)
}

fn authorized(a: &AccountInfo) -> bool {
    let auth = Address::new_from_array(AUTH_ID);
    let (p, _) = Address::find_program_address(&[b"admission"], &auth);
    a.key == &p && a.is_signer
}
fn live(p: &[u8]) -> ProgramResult {
    if !valid_permit(&p, &identity()) || u64::from_le_bytes(p[512..520].try_into().unwrap()) < Clock::get()?.slot {
        return Err(e(830));
    }
    Ok(())
}
fn idle(q: &[u8]) -> ProgramResult {
    if !valid_state(&q, &identity()) || q[ACTIVE_PERMIT_OFFSET..161].iter().any(|b| *b != 0) {
        return Err(e(831));
    }
    Ok(())
}

pub fn process(id: &Address, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.first() == Some(&6) {
        // Only Auth's authenticated upgrade-authority provisioning path may
        // create the quota and choose its administrator. No encrypted state is
        // initialized here; that still requires the signed runtime callback.
        if data != [6] || a.len() != 4 {
            return Err(e(833));
        }
        let system = solana_system_interface::program::id();
        if a[0].key != &Q
            || !a[0].is_writable
            || a[0].owner != &system
            || a[0].data_len() != 0
            || !a[1].is_signer
            || !a[1].is_writable
            || !authorized(&a[2])
            || a[3].key != &system
            || !a[3].executable
        {
            return Err(e(834));
        }
        let (quota, bump) = Address::find_program_address(&[b"quota"], id);
        if quota != Q {
            return Err(e(834));
        }
        cyperlink_pda_provisioning::create_pda(
            id,
            &a[1],
            &a[0],
            &a[3],
            QUOTA_LEN,
            &[b"quota", &[bump]],
        )?;
        let mut q = a[0].try_borrow_mut_data()?;
        if q.len() != QUOTA_LEN {
            return Err(e(834));
        }
        q[96..128].copy_from_slice(a[1].key.as_ref());
        q[STATE_IDENTITY..].copy_from_slice(&identity());
        return Ok(());
    }
    if data.first() == Some(&7) {
        // Permissionless funding of immutable, fully canonical routing only.
        // Callers cannot choose the quota, permit pointer offset or hook.
        if data != [7] || a.len() != 4 {
            return Err(e(835));
        }
        let system = solana_system_interface::program::id();
        if a[0].owner != &spl_token_2022_interface::id()
            || !a[1].is_writable
            || a[1].owner != &system
            || a[1].data_len() != 0
            || !a[2].is_signer
            || !a[2].is_writable
            || a[3].key != &system
            || !a[3].executable
        {
            return Err(e(836));
        }
        {
            let data = a[0].try_borrow_data()?;
            let mint = StateWithExtensions::<Mint>::unpack(&data)?;
            mint.get_extension::<ConfidentialTransferMint>()?;
            let hook: Option<Address> = mint.get_extension::<TransferHook>()?.program_id.into();
            if hook != Some(*id)
                || mint.get_extension_types()?.iter().any(|e| {
                    !matches!(
                        e,
                        ExtensionType::ConfidentialTransferMint | ExtensionType::TransferHook
                    )
                })
            {
                return Err(e(836));
            }
        }
        let (metadata, bump) =
            Address::find_program_address(&[b"extra-account-metas", a[0].key.as_ref()], id);
        if a[1].key != &metadata {
            return Err(e(836));
        }
        let bytes = canonical_metadata(Q.as_array()).map_err(|_| e(836))?;
        cyperlink_pda_provisioning::create_pda(
            id,
            &a[2],
            &a[1],
            &a[3],
            bytes.len(),
            &[b"extra-account-metas", a[0].key.as_ref(), &[bump]],
        )?;
        let mut target = a[1].try_borrow_mut_data()?;
        if target.len() != bytes.len() {
            return Err(e(836));
        }
        target.copy_from_slice(&bytes);
        return Ok(());
    }
    if matches!(data.first(), Some(2) | Some(3)) {
        if a.len() != 2 || a[0].key != &Q || a[0].owner != id || !authorized(&a[1]) {
            return Err(e(820));
        }
        let mut q = a[0].try_borrow_mut_data()?;
        idle(&q)?;
        if data == [3] {
            let next = u64::from_le_bytes(q[88..96].try_into().unwrap())
                .checked_add(1)
                .ok_or(e(822))?;
            q[88..96].copy_from_slice(&next.to_le_bytes());
            return Ok(());
        }
        if data.len() != 145 || q[128] != 0 {
            return Err(e(823));
        }
        q[40..88].copy_from_slice(&data[1..49]);
        q[161..257].copy_from_slice(&data[49..145]);
        q[8..40].copy_from_slice(&state_hash(&data[1..49], &data[49..145], &identity()));
        q[128] = 1;
        return Ok(());
    }
    if matches!(data.first(), Some(4) | Some(5)) {
        if a.len() != 3
            || a[0].owner != id
            || a[1].key != &Q
            || a[1].owner != id
            || !authorized(&a[2])
        {
            return Err(e(824));
        }
        let q = a[1].try_borrow_data()?;
        idle(&q)?;
        let mut p = a[0].try_borrow_mut_data()?;
        if p.len() != PERMIT_LEN || p[0] != 0 {
            return Err(e(825));
        }
        if data == [5] {
            p[0] = 3;
            return Ok(());
        }
        if data.len() != PERMIT_LEN + 1 || p.iter().any(|b| *b != 0) || q[128] != 1 {
            return Err(e(826));
        }
        let t = &data[1..];
        live(t)?;
        if t[0] != 0
            || t[1] != 1
            || t[8..16] != q[..8]
            || t[16..48] != q[8..40]
            || &t[368..400] != Q.as_ref()
            || state_hash(&t[464..512], &t[520..616], &identity()) != t[48..80]
        {
            return Err(e(827));
        }
        p.copy_from_slice(t);
        return Ok(());
    }
    if data == [0] {
        // Guard-only, transient route installation. There is no public arm API.
        if a.len() != 3 || a[0].owner != id || a[1].owner != id || a[1].key != &Q {
            return Err(e(800));
        }
        let (pda, _) = Address::find_program_address(&[b"guard"], &G);
        if a[2].key != &pda || !a[2].is_signer {
            return Err(e(801));
        }
        let mut q = a[1].try_borrow_mut_data()?;
        idle(&q)?;
        let mut p = a[0].try_borrow_mut_data()?;
        live(&p)?;
        if q[128] != 1 || p[0] != 0 || p[1] != 1 {
            return Err(e(802));
        }
        if &p[368..400] != Q.as_ref() || p[8..16] != q[..8] || p[16..48] != q[8..40] {
            return Err(e(803));
        }
        p[0] = 1;
        q[ACTIVE_PERMIT_OFFSET..161].copy_from_slice(a[0].key.as_ref());
        return Ok(());
    }
    if data.len() != 16 || a.len() != 7 {
        return Err(e(804));
    }
    if data[..8] != [105, 37, 101, 197, 75, 251, 102, 26] {
        return Err(e(805));
    }
    if u64::from_le_bytes(data[8..].try_into().unwrap()) != u64::MAX {
        return Err(e(806));
    }
    // Native Execute ABI: source,mint,destination,authority,metadata,quota,permit.
    if a[5].key != &Q
        || a[5].owner != id
        || a[6].owner != id
        || a[0].owner != &spl_token_2022_interface::id()
        || a[1].owner != &spl_token_2022_interface::id()
        || a[2].owner != &spl_token_2022_interface::id()
    {
        return Err(e(807));
    }
    validate_metadata(
        a[1].key.as_array(),
        Q.as_array(),
        id.as_array(),
        a[4].key.as_array(),
        a[4].owner.as_array(),
        &a[4].try_borrow_data()?,
    )
    .map_err(|_| e(832))?;
    let mut q = a[5].try_borrow_mut_data()?;
    let mut p = a[6].try_borrow_mut_data()?;
    live(&p)?;
    if !valid_state(&q, &identity())
        || q[128] != 1
        || p[0] != 1
        || p[1] != 1
        || &q[ACTIVE_PERMIT_OFFSET..161] != a[6].key.as_ref()
    {
        return Err(e(808));
    }
    for (offset, idx) in [(80, 0), (112, 1), (144, 2), (176, 3)] {
        if &p[offset..offset + 32] != a[idx].key.as_ref() {
            return Err(e(810));
        }
    }
    if &p[368..400] != Q.as_ref() || p[8..16] != q[..8] || p[16..48] != q[8..40] {
        return Err(e(811));
    }
    let src = a[0].try_borrow_data()?;
    let source = StateWithExtensions::<Account>::unpack(&src)?;
    let dst = a[2].try_borrow_data()?;
    let destination = StateWithExtensions::<Account>::unpack(&dst)?;
    if !bool::from(source.get_extension::<TransferHookAccount>()?.transferring)
        || !bool::from(
            destination
                .get_extension::<TransferHookAccount>()?
                .transferring,
        )
    {
        return Err(e(812));
    }
    if bytemuck::bytes_of(
        &source
            .get_extension::<ConfidentialTransferAccount>()?
            .available_balance,
    ) != &p[272..336]
    {
        return Err(e(813));
    }
    let version = u64::from_le_bytes(q[..8].try_into().unwrap())
        .checked_add(1)
        .ok_or(e(814))?;
    q[..8].copy_from_slice(&version.to_le_bytes());
    q[8..40].copy_from_slice(&p[48..80]);
    q[40..88].copy_from_slice(&p[464..512]);
    q[161..257].copy_from_slice(&p[520..616]);
    q[ACTIVE_PERMIT_OFFSET..161].fill(0);
    p[0] = 2;
    Ok(())
}

#[cfg(test)]
mod provisioning_tests {
    use super::*;
    #[test]
    fn foreign_release_schema_and_key_domain_are_rejected_before_clock_or_write() {
        let mut permit = [0; PERMIT_LEN];
        permit[616..].copy_from_slice(&identity());
        for i in 616..PERMIT_LEN {
            let mut changed = permit;
            changed[i] ^= 1;
            assert_eq!(live(&changed), Err(e(830)), "identity byte {i}");
        }
        assert_eq!(live(&[0;520]),Err(e(830)));
    }
    #[test]
    fn extra_ciphertexts_do_not_shift_native_hook_pointer() {
        let mut quota=[0;QUOTA_LEN];
        quota[STATE_IDENTITY..].copy_from_slice(&identity());
        quota[161..257].fill(99);
        idle(&quota).unwrap();
        quota[129]=1;
        assert_eq!(idle(&quota),Err(e(831)));
        quota[129]=0;
        quota[321]^=1;
        assert_eq!(idle(&quota),Err(e(831)));
    }
    #[test]
    fn configured_quota_is_the_canonical_policy_pda() {
        let policy = Address::new_from_array(POLICY_ID);
        assert_eq!(Address::find_program_address(&[b"quota"], &policy).0, Q);
    }
    #[test]
    fn provisioning_requires_exact_instruction_and_account_shapes() {
        let policy = Address::new_from_array(POLICY_ID);
        for data in [vec![6], vec![6, 0]] {
            assert_eq!(process(&policy, &[], &data), Err(e(833)));
        }
        for data in [vec![7], vec![7, 0]] {
            assert_eq!(process(&policy, &[], &data), Err(e(835)));
        }
    }
    #[test]
    fn a_direct_quota_provisioner_cannot_choose_the_administrator() {
        let policy = Address::new_from_array(POLICY_ID);
        let system = solana_system_interface::program::id();
        let payer = Address::new_from_array([1; 32]);
        let wrong = Address::new_from_array([2; 32]);
        let mut funds = [0u64; 4];
        let [l0, l1, l2, l3] = &mut funds;
        let mut d0 = [];
        let mut d1 = [];
        let mut d2 = [];
        let mut d3 = [];
        let accounts = [
            AccountInfo::new(&Q, false, true, l0, &mut d0, &system, false),
            AccountInfo::new(&payer, true, true, l1, &mut d1, &system, false),
            AccountInfo::new(&wrong, true, false, l2, &mut d2, &system, false),
            AccountInfo::new(&system, false, false, l3, &mut d3, &system, true),
        ];
        assert_eq!(process(&policy, &accounts, &[6]), Err(e(834)));
        assert!(accounts[0].data_is_empty());
    }
}
