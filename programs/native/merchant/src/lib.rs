//! Consumer A: one-time merchant SKU entitlement. No policy/CT parsing here.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_entrypoint::{entrypoint,ProgramResult};
use solana_program_error::ProgramError;
use solana_sha256_hasher::hashv;
entrypoint!(process);
pub fn process(id:&Address,a:&[AccountInfo],data:&[u8])->ProgramResult{
 if a.len()!=17||data.len()<10||data[0]!=1{return Err(ProgramError::Custom(1000))}
 let sku=&data[1..9];
 if a[16].owner!=id||a[16].data_len()!=49||a[16].try_borrow_data()?[48]!=0||!a[11].is_signer{return Err(ProgramError::Custom(1001))}
 let (record,_)=Address::find_program_address(&[b"purchase",a[11].key.as_ref(),sku],id);
 if a[16].key!=&record{return Err(ProgramError::Custom(1002))}
 let digest=hashv(&[b"merchant-purchase-v1",record.as_ref(),sku,a[11].key.as_ref(),a[7].key.as_ref(),a[6].key.as_ref()]).to_bytes();
 cyperlink_operation::settle(a,id,&digest,&data[10..])?;
 let mut record=a[16].try_borrow_mut_data()?;
 record[..8].copy_from_slice(b"PURCH001");record[8..40].copy_from_slice(a[11].key.as_ref());record[40..48].copy_from_slice(sku);record[48]=1;
 if data[9]!=0{return Err(ProgramError::Custom(1099))}
 Ok(())
}
