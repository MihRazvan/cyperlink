//! Plans genuine native provisioning; writes fresh scoped secrets only to a new private file.
use cyperlink_client_proofs::{ClientKeys,configure_proof,instruction_json,write_new};
use solana_address::Address;
use serde_json::{Value,json};
use std::path::Path;
use spl_token_2022_interface::{extension::{ExtensionType,confidential_transfer::instruction as ct},instruction as token,state::{Account,Mint}};
fn main(){
 let args:Vec<_>=std::env::args().collect();assert_eq!(args.len(),4,"provision KEYS REQUEST OUTPUT");
 let r:Value=serde_json::from_slice(&std::fs::read(&args[2]).unwrap()).unwrap();
 let address=|name:&str|r[name].as_str().unwrap().parse::<Address>().unwrap();
 let keys=ClientKeys::generate();keys.save_new(Path::new(&args[1])).unwrap();
 let source=address("source");let mint=address("mint");let owner=address("owner");let payer=address("payer");let context=address("context");
 let amount=r["amount"].as_u64().unwrap();assert!(amount<=u32::MAX as u64);
 let program=spl_token_2022_interface::id();
 let initialization=vec![ct::initialize_mint(&program,&mint,None,true,None).unwrap(),token::initialize_mint2(&program,&mint,&payer,None,0).unwrap()];
 let mut funding=vec![];
 if amount>0{funding.extend([token::mint_to(&program,&mint,&source,&payer,&[],amount).unwrap(),ct::deposit(&program,&source,&mint,amount,0,&owner,&[]).unwrap(),ct::apply_pending_balance(&program,&source,1,&keys.aes().encrypt(amount).into(),&owner,&[]).unwrap()]);}
 let lock=vec![ct::disable_confidential_credits(&program,&source,&owner,&[]).unwrap(),ct::disable_non_confidential_credits(&program,&source,&owner,&[]).unwrap()];
 let out=json!({"mint_size":ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::ConfidentialTransferMint]).unwrap(),"token_size":ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::ConfidentialTransferAccount]).unwrap(),
 "mint_initialization":initialization.iter().map(instruction_json).collect::<Vec<_>>(),"initialize":instruction_json(&token::initialize_account3(&program,&source,&mint,&owner).unwrap()),
 "configuration":configure_proof(&keys,&source,&mint,&owner,&context,100).unwrap(),"funding":funding.iter().map(instruction_json).collect::<Vec<_>>(),"disable_credits":lock.iter().map(instruction_json).collect::<Vec<_>>(),
 "finalize_mint":instruction_json(&token::set_authority(&program,&mint,None,token::AuthorityType::MintTokens,&payer,&[]).unwrap()),"elgamal_pubkey":keys.public_key_hex()});
 write_new(Path::new(&args[3]),&serde_json::to_vec_pretty(&out).unwrap(),false).unwrap();
}
