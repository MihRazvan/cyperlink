//! Consumer A: one-time merchant SKU entitlement. No policy/CT parsing here.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_entrypoint::{entrypoint, ProgramResult};
use solana_program_error::ProgramError;
use solana_sha256_hasher::hashv;
entrypoint!(process);
fn initialize(id: &Address, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 9 || a.len() != 4 {
        return Err(ProgramError::Custom(1010));
    }
    let system = solana_system_interface::program::id();
    if !a[0].is_signer
        || !a[0].is_writable
        || !a[1].is_signer
        || !a[2].is_writable
        || a[3].key != &system
        || !a[3].executable
        || a[2].owner != &system
        || a[2].data_len() != 0
    {
        return Err(ProgramError::Custom(1011));
    }
    let sku = &data[1..9];
    let (record, bump) = Address::find_program_address(&[b"purchase", a[1].key.as_ref(), sku], id);
    if a[2].key != &record {
        return Err(ProgramError::Custom(1012));
    }
    cyperlink_pda_provisioning::create_pda(
        id,
        &a[0],
        &a[2],
        &a[3],
        49,
        &[b"purchase", a[1].key.as_ref(), sku, &[bump]],
    )
}
pub fn process(id: &Address, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.first() == Some(&0) {
        return initialize(id, a, data);
    }
    if a.len() != 17 || data.len() < 10 || data[0] != 1 {
        return Err(ProgramError::Custom(1000));
    }
    let sku = &data[1..9];
    if a[16].owner != id
        || a[16].data_len() != 49
        || a[16].try_borrow_data()?[48] != 0
        || !a[11].is_signer
    {
        return Err(ProgramError::Custom(1001));
    }
    let (record, _) = Address::find_program_address(&[b"purchase", a[11].key.as_ref(), sku], id);
    if a[16].key != &record {
        return Err(ProgramError::Custom(1002));
    }
    let digest = hashv(&[
        b"merchant-purchase-v1",
        record.as_ref(),
        sku,
        a[11].key.as_ref(),
        a[7].key.as_ref(),
        a[6].key.as_ref(),
    ])
    .to_bytes();
    cyperlink_operation::settle(a, id, &digest, &data[10..])?;
    let mut record = a[16].try_borrow_mut_data()?;
    record[..8].copy_from_slice(b"PURCH001");
    record[8..40].copy_from_slice(a[11].key.as_ref());
    record[40..48].copy_from_slice(sku);
    record[48] = 1;
    if data[9] != 0 {
        return Err(ProgramError::Custom(1099));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initialization_rejects_malformed_payload_before_syscalls() {
        let program = Address::new_from_array([84; 32]);
        assert_eq!(
            process(&program, &[], &[0]),
            Err(ProgramError::Custom(1010))
        );
        assert_eq!(
            process(&program, &[], &[0; 9]),
            Err(ProgramError::Custom(1010))
        );
    }
    #[test]
    fn initialization_rejects_missing_signatures_wrong_system_and_wrong_pda() {
        let program = Address::new_from_array([84; 32]);
        let payer = Address::new_from_array([1; 32]);
        let buyer = Address::new_from_array([2; 32]);
        let system = solana_system_interface::program::id();
        let product = [3u8; 8];
        let record =
            Address::find_program_address(&[b"purchase", buyer.as_ref(), &product], &program).0;
        let wrong = Address::new_from_array([4; 32]);
        let mut payload = vec![0];
        payload.extend(product);
        for case in 0..7 {
            let mut funds = [0u64; 4];
            let [l0, l1, l2, l3] = &mut funds;
            let mut d0 = [];
            let mut d1 = [];
            let mut d2 = [];
            let mut d3 = [];
            let accounts = [
                AccountInfo::new(&payer, case != 0, case != 1, l0, &mut d0, &system, false),
                AccountInfo::new(&buyer, case != 2, false, l1, &mut d1, &system, false),
                AccountInfo::new(
                    if case == 6 { &wrong } else { &record },
                    false,
                    case != 3,
                    l2,
                    &mut d2,
                    &system,
                    false,
                ),
                AccountInfo::new(
                    if case == 4 { &wrong } else { &system },
                    false,
                    false,
                    l3,
                    &mut d3,
                    &system,
                    case != 5,
                ),
            ];
            assert_eq!(
                process(&program, &accounts, &payload),
                Err(ProgramError::Custom(if case == 6 { 1012 } else { 1011 })),
                "case {case}"
            );
        }
    }
}
