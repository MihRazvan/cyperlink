use solana_account_info::AccountInfo;use solana_address::Address;use solana_program_entrypoint::{entrypoint,ProgramResult};use solana_program_error::ProgramError;
use spl_token_2022_interface::extension::{StateWithExtensions,BaseStateWithExtensions,transfer_hook::TransferHookAccount,confidential_transfer::ConfidentialTransferAccount};use spl_token_2022_interface::state::Account;
entrypoint!(process);const G:Address=Address::new_from_array([81;32]);
fn e(n:u32)->ProgramError{ProgramError::Custom(n)}
use solana_clock::Clock; use solana_sysvar::Sysvar; use solana_sha256_hasher::hashv;
const Q:Address=Address::new_from_array([61;32]);
fn authorized(a:&AccountInfo)->bool {
 let auth:Address="5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ".parse().unwrap();
 let (p,_)=Address::find_program_address(&[b"admission"],&auth);a.key==&p && a.is_signer
}
fn live(p:&[u8])->ProgramResult{if p.len()!=520||u64::from_le_bytes(p[512..520].try_into().unwrap())<Clock::get()?.slot{return Err(e(830))}Ok(())}
pub fn process(id:&Address,a:&[AccountInfo],data:&[u8])->ProgramResult{
 if matches!(data.first(),Some(2)|Some(3)) {
  if a.len()!=2||a[0].key!=&Q||a[0].owner!=id||!authorized(&a[1]){return Err(e(820))}
  let mut q=a[0].try_borrow_mut_data()?;if q.len()!=129{return Err(e(821))}
  if data==[3] {let next=u64::from_le_bytes(q[88..96].try_into().unwrap()).checked_add(1).ok_or(e(822))?;q[88..96].copy_from_slice(&next.to_le_bytes());return Ok(())}
  if data.len()!=49||q[128]!=0{return Err(e(823))}
  q[40..88].copy_from_slice(&data[1..49]);q[8..40].copy_from_slice(hashv(&[&data[1..49]]).as_ref());q[128]=1;return Ok(())
 }
 if matches!(data.first(),Some(4)|Some(5)) {
  if a.len()!=3||a[0].owner!=id||a[1].key!=&Q||a[1].owner!=id||!authorized(&a[2]){return Err(e(824))}
  let mut p=a[0].try_borrow_mut_data()?;if p.len()!=520||p[0]!=0{return Err(e(825))}
  if data==[5] {p[0]=3;return Ok(())}
  let q=a[1].try_borrow_data()?;if data.len()!=521||p.iter().any(|b|*b!=0)||q.len()!=129||q[128]!=1{return Err(e(826))}
  let t=&data[1..];live(t)?;
  if t[0]!=0||t[1]!=1||t[8..16]!=q[..8]||t[16..48]!=q[8..40]||&t[368..400]!=Q.as_ref()||hashv(&[&t[464..512]]).as_ref()!=&t[48..80]{return Err(e(827))}
  p.copy_from_slice(t);return Ok(())
 }

 if data==[0]{if a.len()!=3||a[0].owner!=id||a[1].owner!=id{return Err(e(800))}let (pda,_)=Address::find_program_address(&[b"guard"],&G);if a[2].key!=&pda||!a[2].is_signer{return Err(e(801))}
 let mut p=a[0].try_borrow_mut_data()?;live(&p)?;let q=a[1].try_borrow_data()?;if p.len()!=520||q.len()!=129||p[0]!=0||p[1]==0{return Err(e(802))}if &p[368..400]!=a[1].key.as_ref()||p[8..16]!=q[..8]||p[16..48]!=q[8..40]{return Err(e(803))}p[0]=1;return Ok(())}
 if data.len()!=16||a.len()!=7{return Err(e(804))}
 // Execute discriminator is fixed by official transfer-hook interface.
 if &data[..8]!=&[105,37,101,197,75,251,102,26]{return Err(e(805))}
 let amount=u64::from_le_bytes(data[8..].try_into().unwrap());if amount!=u64::MAX{return Err(e(806))}
 if a[5].owner!=id||a[6].owner!=id||a[0].owner!=&spl_token_2022_interface::id()||a[2].owner!=&spl_token_2022_interface::id(){return Err(e(807))}
 let mut p=a[5].try_borrow_mut_data()?;live(&p)?;let mut q=a[6].try_borrow_mut_data()?;if p.len()!=520||q.len()!=129||p[0]!=1{return Err(e(808))}
 if p[1]==2 && amount>100{return Err(e(809))} // Naive public-amount-cap baseline: sentinel exceeds cap.
 for(offset,idx)in[(80,0),(112,1),(144,2),(176,3)]{if &p[offset..offset+32]!=a[idx].key.as_ref(){return Err(e(810))}}
 if &p[368..400]!=a[6].key.as_ref()||p[8..16]!=q[..8]||p[16..48]!=q[8..40]{return Err(e(811))}
 let src=a[0].try_borrow_data()?;let state=StateWithExtensions::<Account>::unpack(&src)?;
 if !bool::from(state.get_extension::<TransferHookAccount>()?.transferring){return Err(e(812))}
 if bytemuck::bytes_of(&state.get_extension::<ConfidentialTransferAccount>()?.available_balance)!=&p[272..336]{return Err(e(813))}
 let version=u64::from_le_bytes(q[..8].try_into().unwrap()).checked_add(1).ok_or(e(814))?;q[..8].copy_from_slice(&version.to_le_bytes());q[8..40].copy_from_slice(&p[48..80]);q[40..88].copy_from_slice(&p[464..512]);p[0]=2;Ok(())
}
