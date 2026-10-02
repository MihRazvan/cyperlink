//! Consumer B: product-specific expiring license. Same-author research reuse,
//! not evidence of independent external adoption. No permit/CT parsing here.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_entrypoint::{entrypoint, ProgramResult};
use solana_program_error::ProgramError;
use solana_sha256_hasher::hashv;
use solana_sysvar::Sysvar;
entrypoint!(execute);

fn initialize(program: &Address, accounts: &[AccountInfo], payload: &[u8]) -> ProgramResult {
    if payload.len() != 33 || accounts.len() != 4 {
        return Err(ProgramError::Custom(1110));
    }
    let system = solana_system_interface::program::id();
    if !accounts[0].is_signer
        || !accounts[0].is_writable
        || !accounts[1].is_signer
        || !accounts[2].is_writable
        || accounts[3].key != &system
        || !accounts[3].executable
        || accounts[2].owner != &system
        || accounts[2].data_len() != 0
    {
        return Err(ProgramError::Custom(1111));
    }
    let product = &payload[1..33];
    let (record, bump) =
        Address::find_program_address(&[b"license", accounts[1].key.as_ref(), product], program);
    if accounts[2].key != &record {
        return Err(ProgramError::Custom(1112));
    }
    cyperlink_pda_provisioning::create_pda(
        program,
        &accounts[0],
        &accounts[2],
        &accounts[3],
        81,
        &[b"license", accounts[1].key.as_ref(), product, &[bump]],
    )
}

pub fn execute(program: &Address, accounts: &[AccountInfo], payload: &[u8]) -> ProgramResult {
    if payload.first() == Some(&0) {
        return initialize(program, accounts, payload);
    }
    if payload.len() < 42 || payload[0] != 2 || accounts.len() != 17 {
        return Err(ProgramError::Custom(1100));
    }
    let product = &payload[1..33];
    let expiry = u64::from_le_bytes(payload[33..41].try_into().unwrap());
    let now = solana_clock::Clock::get()?.slot;
    if expiry <= now || expiry > now.saturating_add(1000) {
        return Err(ProgramError::Custom(1101));
    }
    let license = &accounts[16];
    let buyer = &accounts[11];
    if !buyer.is_signer
        || license.owner != program
        || license.data_len() != 81
        || license.try_borrow_data()?[80] != 0
    {
        return Err(ProgramError::Custom(1102));
    }
    let (expected, _) =
        Address::find_program_address(&[b"license", buyer.key.as_ref(), product], program);
    if license.key != &expected {
        return Err(ProgramError::Custom(1103));
    }
    let contract = hashv(&[
        b"licensed-product-v1",
        expected.as_ref(),
        product,
        &expiry.to_le_bytes(),
        buyer.key.as_ref(),
        accounts[7].key.as_ref(),
        accounts[6].key.as_ref(),
    ])
    .to_bytes();
    cyperlink_operation::settle(accounts, program, &contract, &payload[42..])?;
    let mut state = license.try_borrow_mut_data()?;
    state[..8].copy_from_slice(b"LICENSE1");
    state[8..40].copy_from_slice(buyer.key.as_ref());
    state[40..72].copy_from_slice(product);
    state[72..80].copy_from_slice(&expiry.to_le_bytes());
    state[80] = 1;
    if payload[41] != 0 {
        return Err(ProgramError::Custom(1199));
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
            execute(&program, &[], &[0]),
            Err(ProgramError::Custom(1110))
        );
        assert_eq!(
            execute(&program, &[], &[0; 33]),
            Err(ProgramError::Custom(1110))
        );
    }
    #[test]
    fn initialization_rejects_missing_signatures_wrong_system_and_wrong_pda() {
        let program = Address::new_from_array([84; 32]);
        let payer = Address::new_from_array([1; 32]);
        let buyer = Address::new_from_array([2; 32]);
        let system = solana_system_interface::program::id();
        let product = [3u8; 32];
        let record =
            Address::find_program_address(&[b"license", buyer.as_ref(), &product], &program).0;
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
                execute(&program, &accounts, &payload),
                Err(ProgramError::Custom(if case == 6 { 1112 } else { 1111 })),
                "case {case}"
            );
        }
    }
}
