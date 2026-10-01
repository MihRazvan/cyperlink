use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_entrypoint::{entrypoint,ProgramResult};
use solana_program_error::ProgramError;
use solana_instruction::{Instruction,AccountMeta};
use solana_cpi::{invoke,invoke_signed};
use solana_sha256_hasher::hashv;
entrypoint!(process);
const H:Address=Address::new_from_array([82;32]);
fn fail()->ProgramError{ProgramError::Custom(700)}
pub fn process(id:&Address,a:&[AccountInfo],data:&[u8])->ProgramResult{
 if a.len()!=15 || data.len()<34 ||data[0]!=1{return Err(fail())}
 let p=a[0].try_borrow_data()?;
 if a[0].owner!=&H ||p.len()!=520||p[0]!=0|| !a[11].is_signer||a[3].key!=&H||a[4].key!=&spl_token_2022_interface::id(){return Err(fail())}

 if &p[400..432]!=a[13].key.as_ref() || !a[13].executable || &p[432..464]!=&data[2..34] || !a[14].is_signer{return Err(ProgramError::Custom(705))}
 let (consumer,_)=Address::find_program_address(&[b"cyperlink-action",&data[2..34]],a[13].key);if &consumer!=a[14].key{return Err(ProgramError::Custom(706))}
 for (offset,idx) in [(80,5),(112,6),(144,7),(176,11)]{if &p[offset..offset+32]!=a[idx].key.as_ref(){return Err(fail())}}
 if hashv(&[&a[5].try_borrow_data()?]).as_ref()!=&p[208..240]{return Err(ProgramError::Custom(701))}
 let proof_data=a[9].try_borrow_data()?;
 if a[9].owner!=&solana_zk_elgamal_proof_interface::id(){return Err(fail())}
 use solana_zk_elgamal_proof_interface::{state::ProofContextState,proof_data::BatchedGroupedCiphertext3HandlesValidityProofContext};
 let ctx=bytemuck::try_from_bytes::<ProofContextState<BatchedGroupedCiphertext3HandlesValidityProofContext>>(&proof_data).map_err(|_|fail())?;
 use solana_curve25519::{ristretto::{PodRistrettoPoint,add_ristretto,multiply_ristretto},scalar::PodScalar};
 let lo=PodRistrettoPoint(bytemuck::bytes_of(&ctx.proof_context.grouped_ciphertext_lo.extract_commitment()).try_into().unwrap());
 let hi=PodRistrettoPoint(bytemuck::bytes_of(&ctx.proof_context.grouped_ciphertext_hi.extract_commitment()).try_into().unwrap());
 let mut shift=[0u8;32];shift[2]=1;let scaled=multiply_ristretto(&PodScalar(shift),&hi).ok_or(fail())?;let combined=add_ristretto(&lo,&scaled).ok_or(fail())?;
 if &combined.0!=&p[336..368]{return Err(ProgramError::Custom(704))}drop(proof_data);
 let mut hashparts=vec![&data[34..]];for i in [5,6,7,8,9,10,11]{hashparts.push(a[i].key.as_ref());}
 let eq=a[8].try_borrow_data()?;let val=a[9].try_borrow_data()?;let range=a[10].try_borrow_data()?;hashparts.extend([eq.as_ref(),val.as_ref(),range.as_ref()]);
 if hashv(&hashparts).as_ref()!=&p[240..272]{return Err(ProgramError::Custom(702))}drop(p);drop(eq);drop(val);drop(range);
 let (signer,bump)=Address::find_program_address(&[b"guard"],id);if &signer!=a[2].key{return Err(fail())}
 let arm=Instruction{program_id:H,accounts:vec![AccountMeta::new(*a[0].key,false),AccountMeta::new(*a[1].key,false),AccountMeta::new_readonly(signer,true)],data:vec![0]};
 invoke_signed(&arm,&[a[0].clone(),a[1].clone(),a[2].clone(),a[3].clone()],&[&[b"guard",&[bump]]])?;
 let mut metas=Vec::new();for i in [5,6,7,8,9,10,11,0,1,12,3]{metas.push(if [5,7,0,1].contains(&i){AccountMeta::new(*a[i].key,i==11)}else{AccountMeta::new_readonly(*a[i].key,i==11)});}
 let ct=Instruction{program_id:*a[4].key,accounts:metas,data:data[34..].to_vec()};invoke(&ct,a)?;
 if a[0].try_borrow_data()?[0]!=2{return Err(ProgramError::Custom(703))}
 if data[1]!=0{return Err(ProgramError::Custom(799))}Ok(())
}
