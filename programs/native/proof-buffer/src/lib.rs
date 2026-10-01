//! Local proof upload storage. Native ZK verification remains the verifier.
//! A randomly generated buffer account key authorizes writes/closure. Keep its
//! signing key client-side until cleanup. No token account keys are used here.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_entrypoint::{entrypoint, ProgramResult};
use solana_program_error::ProgramError;

entrypoint!(process);
pub fn process(id: &Address, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let buffer = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if buffer.owner != id || !buffer.is_signer || !buffer.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if buffer.data_len() == 0 || buffer.data_len() > 16_384 {
        return Err(ProgramError::InvalidAccountData);
    }
    match data.first() {
        Some(0) if accounts.len() == 1 && (6..=905).contains(&data.len()) => {
            let start = u32::from_le_bytes(data[1..5].try_into().unwrap()) as usize;
            let end = start.checked_add(data.len() - 5).ok_or(ProgramError::InvalidInstructionData)?;
            let mut bytes = buffer.try_borrow_mut_data()?;
            let target = bytes.get_mut(start..end).ok_or(ProgramError::AccountDataTooSmall)?;
            target.copy_from_slice(&data[5..]);
            Ok(())
        }
        Some(1) if data.len() == 1 && accounts.len() == 2 => {
            let refund = &accounts[1];
            if refund.key == buffer.key || !refund.is_writable {
                return Err(ProgramError::InvalidArgument);
            }
            let total = refund.lamports().checked_add(buffer.lamports()).ok_or(ProgramError::ArithmeticOverflow)?;
            **refund.try_borrow_mut_lamports()? = total;
            **buffer.try_borrow_mut_lamports()? = 0;
            buffer.resize(0)?;
            buffer.assign(&Address::default());
            Ok(())
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
