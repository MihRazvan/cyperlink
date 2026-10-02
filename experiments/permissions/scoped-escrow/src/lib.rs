//! Isolated native-capacity authority probe. No Arcium query or Approvals changes.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_error::{ProgramError,ProgramResult};
use solana_instruction::{Instruction,AccountMeta};
use solana_sysvar::Sysvar;
use spl_token_2022_interface::{extension::{BaseStateWithExtensions,StateWithExtensions,ExtensionType,
    confidential_transfer::{ConfidentialTransferAccount,ConfidentialTransferMint,instruction::TransferInstructionData}},
    state::{Account as TokenAccount,AccountState,Mint},instruction::{AuthorityType,set_authority}};
solana_program_entrypoint::entrypoint!(process);
const LEN:usize=313;
fn err(code:u32)->ProgramError{ProgramError::Custom(code)}
fn n(data:&[u8],offset:usize)->u64{u64::from_le_bytes(data[offset..offset+8].try_into().unwrap())}
fn pk(data:&[u8],offset:usize)->Address{Address::new_from_array(data[offset..offset+32].try_into().unwrap())}
fn require(ok:bool,code:u32)->ProgramResult{if ok{Ok(())}else{Err(err(code))}}
fn source_profile(data:&[u8],mint:&Address,owner:&Address)->ProgramResult{
 let s=StateWithExtensions::<TokenAccount>::unpack(data)?;
 require(s.base.mint==*mint&&s.base.owner==*owner&&s.base.state==AccountState::Initialized&&s.base.amount==0&&s.base.delegate.is_none()&&s.base.close_authority.is_none(),910)?;
 require(s.get_extension_types()?==vec![ExtensionType::ConfidentialTransferAccount],911)?;
 let c=s.get_extension::<ConfidentialTransferAccount>()?;
 require(bool::from(c.approved)&&!bool::from(c.allow_confidential_credits)&&!bool::from(c.allow_non_confidential_credits)&&u64::from(c.pending_balance_credit_counter)==0&&c.pending_balance_lo.0==[0;64]&&c.pending_balance_hi.0==[0;64],912)
}
pub fn process(program:&Address,a:&[AccountInfo],d:&[u8])->ProgramResult{
 require(!d.is_empty(),900)?;
 match d[0]{
  0=>{ // initial grant; owner signs once, source authority rotates atomically
   require(a.len()==7&&d.len()==81,900)?;
   let(g,owner,source,mint,dest,token,system)=(&a[0],&a[1],&a[2],&a[3],&a[4],&a[5],&a[6]);
   require(owner.is_signer&&owner.is_writable,901)?;
   require(token.key==&spl_token_2022_interface::id()&&token.executable&&source.owner==token.key&&mint.owner==token.key&&dest.owner==token.key,902)?;
   let(pda,bump)=Address::find_program_address(&[b"grant",source.key.as_ref()],program);require(g.key==&pda&&source.key!=dest.key,903)?;
   let expiry=n(d,65);let max=n(d,73);require(expiry>solana_clock::Clock::get()?.slot&&max>0,904)?;
   let md=mint.try_borrow_data()?;let m=StateWithExtensions::<Mint>::unpack(&md)?;
   require(m.get_extension_types()?==vec![ExtensionType::ConfidentialTransferMint]&&m.base.is_initialized&&m.base.freeze_authority.is_none()&&m.base.mint_authority.is_none(),911)?;
   let cm=m.get_extension::<ConfidentialTransferMint>()?;require(cm.auditor_elgamal_pubkey==Default::default()&&cm.authority==Default::default(),911)?;
   drop(md);
   source_profile(&source.try_borrow_data()?,mint.key,owner.key)?;
   {let dd=dest.try_borrow_data()?;let ds=StateWithExtensions::<TokenAccount>::unpack(&dd)?;require(ds.base.mint==*mint.key&&ds.base.state==AccountState::Initialized&&ds.get_extension_types()?==vec![ExtensionType::ConfidentialTransferAccount],911)?;ds.get_extension::<ConfidentialTransferAccount>()?.valid_as_destination()?;}
   cyperlink_pda_provisioning::create_pda(program,owner,g,system,LEN,&[b"grant",source.key.as_ref(),&[bump]])?;
   {let mut data=g.try_borrow_mut_data()?;data[0]=1;data[9..17].copy_from_slice(&expiry.to_le_bytes());data[17..25].copy_from_slice(&max.to_le_bytes());
    for(off,key)in[(25,owner.key),(89,source.key),(121,mint.key),(153,dest.key)]{data[off..off+32].copy_from_slice(key.as_ref());}
    data[57..89].copy_from_slice(&d[1..33]);data[185..217].copy_from_slice(&d[33..65]);
    let sd=source.try_borrow_data()?;let s=StateWithExtensions::<TokenAccount>::unpack(&sd)?;data[217..281].copy_from_slice(&s.get_extension::<ConfidentialTransferAccount>()?.available_balance.0);
   }
   let ix=set_authority(token.key,source.key,Some(g.key),AuthorityType::AccountOwner,owner.key,&[])?;
   solana_cpi::invoke(&ix,&[source.clone(),owner.clone(),token.clone()])
  }
  1=>{ // exact next effect + native transfer, using the grant PDA as CT owner
   require(a.len()==9&&d.len()==41+2+core::mem::size_of::<TransferInstructionData>(),900)?;
   let(g,agent,source,mint,dest,token)=(&a[0],&a[1],&a[2],&a[3],&a[4],&a[8]);
   require(g.owner==program&&g.data_len()==LEN,902)?;
   let(pda,bump)=Address::find_program_address(&[b"grant",source.key.as_ref()],program);require(g.key==&pda,903)?;
   let data=g.try_borrow_data()?;require(data[0]==1,905)?;require(agent.is_signer&&*agent.key==pk(&data,57),901)?;
   require(solana_clock::Clock::get()?.slot<n(&data,9),904)?;
   require(n(d,1)==n(&data,1)&&n(&data,1)<n(&data,17),906)?;
   require(*source.key==pk(&data,89)&&*mint.key==pk(&data,121)&&*dest.key==pk(&data,153),907)?;
   require(d[9..41]==data[185..217],908)?;
   require(token.key==&spl_token_2022_interface::id()&&token.executable&&source.owner==token.key&&mint.owner==token.key&&dest.owner==token.key,902)?;
   source_profile(&source.try_borrow_data()?,mint.key,g.key)?;
   // Exact no-fee CT instruction, three context accounts; no offset/instruction aliases.
   require(d[41]==27&&d[42]==7&&d[d.len()-3..]==[0,0,0],909)?;
   let counter=n(&data,1).checked_add(1).ok_or(err(906))?;drop(data);
   let ix=Instruction{program_id:*token.key,data:d[41..].to_vec(),accounts:vec![AccountMeta::new(*source.key,false),AccountMeta::new_readonly(*mint.key,false),AccountMeta::new(*dest.key,false),AccountMeta::new_readonly(*a[5].key,false),AccountMeta::new_readonly(*a[6].key,false),AccountMeta::new_readonly(*a[7].key,false),AccountMeta::new_readonly(*g.key,true)]};
   solana_cpi::invoke_signed(&ix,&[source.clone(),mint.clone(),dest.clone(),a[5].clone(),a[6].clone(),a[7].clone(),g.clone(),token.clone()],&[&[b"grant",source.key.as_ref(),&[bump]]])?;
   // A scoped execution receipt is the application effect; not a priced merchant entitlement.
   let mut data=g.try_borrow_mut_data()?;data[1..9].copy_from_slice(&counter.to_le_bytes());
   data[281..313].copy_from_slice(&solana_sha256_hasher::hashv(&[b"cyperlink-permissions-effect-v1",g.key.as_ref(),&d[1..]]).to_bytes());Ok(())
  }
  2=>{ // grantor revokes and regains spending authority, including after expiry
   require(a.len()==4&&d.len()==1,900)?;let(g,owner,source,token)=(&a[0],&a[1],&a[2],&a[3]);
   require(g.owner==program&&g.data_len()==LEN&&token.key==&spl_token_2022_interface::id()&&token.executable&&source.owner==token.key,902)?;
   let(pda,bump)=Address::find_program_address(&[b"grant",source.key.as_ref()],program);require(g.key==&pda,903)?;
   let data=g.try_borrow_data()?;require(data[0]==1,905)?;require(owner.is_signer&&*owner.key==pk(&data,25)&&*source.key==pk(&data,89),901)?;drop(data);
   let ix=set_authority(token.key,source.key,Some(owner.key),AuthorityType::AccountOwner,g.key,&[])?;
   solana_cpi::invoke_signed(&ix,&[source.clone(),g.clone(),token.clone()],&[&[b"grant",source.key.as_ref(),&[bump]]])?;
   g.try_borrow_mut_data()?[0]=2;Ok(())
  }
  _=>Err(err(900))
 }
}
