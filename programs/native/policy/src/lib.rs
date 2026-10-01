use cyperlink_hook_routing::{validate_metadata, ACTIVE_PERMIT_OFFSET, QUOTA_LEN};
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_clock::Clock;
use solana_program_entrypoint::{entrypoint, ProgramResult};
use solana_program_error::ProgramError;
use solana_sha256_hasher::hashv;
use solana_sysvar::Sysvar;
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount, transfer_hook::TransferHookAccount,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account,
};

entrypoint!(process);
const G: Address = Address::new_from_array([81; 32]);
const Q: Address = Address::new_from_array([61; 32]);
fn e(n: u32) -> ProgramError {
    ProgramError::Custom(n)
}

fn authorized(a: &AccountInfo) -> bool {
    let auth: Address = "5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ"
        .parse()
        .unwrap();
    let (p, _) = Address::find_program_address(&[b"admission"], &auth);
    a.key == &p && a.is_signer
}
fn live(p: &[u8]) -> ProgramResult {
    if p.len() != 520 || u64::from_le_bytes(p[512..520].try_into().unwrap()) < Clock::get()?.slot {
        return Err(e(830));
    }
    Ok(())
}
fn idle(q: &[u8]) -> ProgramResult {
    if q.len() != QUOTA_LEN || q[ACTIVE_PERMIT_OFFSET..].iter().any(|b| *b != 0) {
        return Err(e(831));
    }
    Ok(())
}

pub fn process(id: &Address, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
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
        if data.len() != 49 || q[128] != 0 {
            return Err(e(823));
        }
        q[40..88].copy_from_slice(&data[1..49]);
        q[8..40].copy_from_slice(hashv(&[&data[1..49]]).as_ref());
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
        if p.len() != 520 || p[0] != 0 {
            return Err(e(825));
        }
        if data == [5] {
            p[0] = 3;
            return Ok(());
        }
        if data.len() != 521 || p.iter().any(|b| *b != 0) || q[128] != 1 {
            return Err(e(826));
        }
        let t = &data[1..];
        live(t)?;
        if t[0] != 0
            || t[1] != 1
            || t[8..16] != q[..8]
            || t[16..48] != q[8..40]
            || &t[368..400] != Q.as_ref()
            || hashv(&[&t[464..512]]).as_ref() != &t[48..80]
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
        q[ACTIVE_PERMIT_OFFSET..].copy_from_slice(a[0].key.as_ref());
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
    if q.len() != QUOTA_LEN
        || q[128] != 1
        || p[0] != 1
        || p[1] != 1
        || &q[ACTIVE_PERMIT_OFFSET..] != a[6].key.as_ref()
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
    q[ACTIVE_PERMIT_OFFSET..].fill(0);
    p[0] = 2;
    Ok(())
}
