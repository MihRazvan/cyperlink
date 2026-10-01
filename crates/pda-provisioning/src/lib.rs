//! Allocate a caller-authenticated PDA despite permissionless prefunding.
//! The caller must check its application authority and semantic PDA before
//! invoking this helper. It never replaces initialized or program-owned state.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_error::{ProgramError, ProgramResult};
use solana_sysvar::Sysvar;

pub fn create_pda<'a>(
    program: &Address,
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    space: usize,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let system_id = solana_system_interface::program::id();
    if !payer.is_signer || !payer.is_writable || !target.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key != &system_id || !system.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    if target.owner != &system_id
        || !target.data_is_empty()
        || target.executable
        || target.key == payer.key
    {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    if space == 0
        || space > 16_384
        || Address::create_program_address(signer_seeds, program)
            .map_err(|_| ProgramError::InvalidSeeds)?
            != *target.key
    {
        return Err(ProgramError::InvalidSeeds);
    }
    // Creating an account rejects any nonzero preexisting lamports. Instead,
    // preserve donations, fund only the shortfall, then allocate and assign.
    let needed = solana_rent::Rent::get()?
        .minimum_balance(space)
        .saturating_sub(target.lamports());
    if needed != 0 {
        let ix = solana_system_interface::instruction::transfer(payer.key, target.key, needed);
        solana_cpi::invoke(&ix, &[payer.clone(), target.clone(), system.clone()])?;
    }
    let allocate = solana_system_interface::instruction::allocate(target.key, space as u64);
    solana_cpi::invoke_signed(
        &allocate,
        &[target.clone(), system.clone()],
        &[signer_seeds],
    )?;
    let assign = solana_system_interface::instruction::assign(target.key, program);
    solana_cpi::invoke_signed(&assign, &[target.clone(), system.clone()], &[signer_seeds])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authentication_and_existing_state_rejected_before_funding() {
        let program = Address::new_from_array([82; 32]);
        let payer = Address::new_from_array([3; 32]);
        let system = solana_system_interface::program::id();
        let (pda, bump) = Address::find_program_address(&[b"test"], &program);
        let wrong = Address::new_from_array([4; 32]);
        for case in 0..7 {
            let mut payer_funds = 10_000_000;
            let mut target_funds = 1_000_000;
            let mut system_funds = 0;
            let mut payer_data = [];
            let mut target_data = if case == 2 { vec![0] } else { vec![] };
            let mut system_data = [];
            let p = AccountInfo::new(
                &payer,
                case != 0,
                true,
                &mut payer_funds,
                &mut payer_data,
                &system,
                false,
            );
            let t = AccountInfo::new(
                if case == 4 { &wrong } else { &pda },
                false,
                true,
                &mut target_funds,
                &mut target_data,
                if case == 1 { &program } else { &system },
                case == 6,
            );
            let s = AccountInfo::new(
                if case == 3 { &wrong } else { &system },
                false,
                false,
                &mut system_funds,
                &mut system_data,
                &system,
                case != 5,
            );
            let result = create_pda(&program, &p, &t, &s, 49, &[b"test", &[bump]]);
            assert_eq!(
                result,
                Err(match case {
                    0 => ProgramError::MissingRequiredSignature,
                    1 | 2 | 6 => ProgramError::AccountAlreadyInitialized,
                    3 | 5 => ProgramError::IncorrectProgramId,
                    _ => ProgramError::InvalidSeeds,
                })
            );
            assert_eq!(p.lamports(), 10_000_000);
            assert_eq!(t.lamports(), 1_000_000);
        }
    }
}
