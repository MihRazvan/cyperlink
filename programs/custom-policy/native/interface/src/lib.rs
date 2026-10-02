//! Shared operation ABI only; no merchant/license business rules.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_error::ProgramError;
use solana_instruction::{Instruction,AccountMeta};
mod deployment { include!("../../deployment.rs"); }
pub const KERNEL:Address=Address::new_from_array(deployment::GUARD_ID);
pub fn settle(a:&[AccountInfo],consumer:&Address,digest:&[u8;32],native:&[u8])->Result<(),ProgramError>{
 if a.len()<16 || a[13].key!=consumer || a[15].key!=&KERNEL{return Err(ProgramError::Custom(900))}
 let (authority,bump)=Address::find_program_address(&[b"cyperlink-action",digest],consumer);
 if a[14].key!=&authority{return Err(ProgramError::Custom(901))}
 let mut data=vec![1,0];data.extend(digest);data.extend(native);
 let accounts=a[..15].iter().enumerate().map(|(i,x)|AccountMeta{pubkey:*x.key,is_writable:x.is_writable,is_signer:x.is_signer||i==14}).collect();
 let ix=Instruction{program_id:KERNEL,accounts,data};
 solana_cpi::invoke_signed(&ix,&a[..16],&[&[b"cyperlink-action",digest,&[bump]]])
}
