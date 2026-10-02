// Isolated real-local-validator probe. No distributed runtime or production profile.
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createPrivateRun, writeNew, loadWeb3, saveSigner, instructionFromJSON, LocalSession, TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';
import { verifyPreparedProof, verifyTransferProofs } from '../../packages/local-client/src/proofs.mjs';
const exec=promisify(execFile), out=await createPrivateRun(process.argv[2]), web3=await loadWeb3('.local/toolchain/js');
const pk=x=>new web3.PublicKey(x), E=pk(Buffer.alloc(32,91)), B=pk(Buffer.alloc(32,89)), endpoint='http://127.0.0.1:8979';
const paths={validator:resolve('.local/toolchain/native/agave-4.3.0/solana-release/bin/solana-test-validator'),token:resolve('.local/toolchain/native/programs/token-2022.so'),escrow:resolve('.local/permissions-escrow-elf/cyperlink_scoped_escrow_probe.so'),buffer:resolve('target/deploy/cyperlink_proof_buffer.so'),prover:resolve('crates/client-proofs/target/debug/cyperlink-client-proofs'),provision:resolve('.local/permissions-authority-build/debug/provision')};
const hash=b=>createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pins=JSON.parse(await readFile('config/local-toolchain.json'));
if(hash(await readFile(paths.validator))!==pins.executables.validator.sha256||hash(await readFile(paths.token))!==pins.public_programs.find(p=>p.name==='token-2022').sha256)throw Error('Pinned validator/token artifact changed');
const payer=web3.Keypair.generate(),owner=web3.Keypair.generate(),agent=web3.Keypair.generate();
for(const [name,s]of Object.entries({payer,owner,agent}))await saveSigner(resolve(out,`${name}.json`),s);
const log=await open(resolve(out,'validator.log'),'wx',0o600);
const child=spawn(paths.validator,['--ledger',resolve(out,'ledger'),'--rpc-port','8979','--bind-address','127.0.0.1','--faucet-sol','1000','--mint',payer.publicKey.toBase58(),'--bpf-program',TOKEN_PROGRAM,paths.token,'--bpf-program',E.toBase58(),paths.escrow,'--bpf-program',B.toBase58(),paths.buffer,'--quiet'],{stdio:['ignore',log.fd,log.fd]});
await writeNew(resolve(out,'validator-pid.json'),JSON.stringify({pid:child.pid,rpc:endpoint}));console.log('validator PID',child.pid);
const session=new LocalSession({web3,endpoint,payer,directory:out});
const results={schema_version:1,evidence_level:'real-local-validator-signed-native-capacity-escrow',distributed:false,passed:false,checks:[],limitations:['Separate experimental authority profile; no Arcium/shared business quota','Application effect is a scoped execution receipt, not a priced merchant entitlement','Dedicated escrow key is shared with executor and backed up by grantor; no wallet key is shared','Honest refund does not qualify recovery after malicious decryptable-balance corruption'],test_observer_disclosures:{initial:100,spend:60,refund:40}};
const check=(name,data={})=>results.checks.push({name,...data});
try{
 for(let i=0;i<120;i++){try{await session.assertLocalVersions();break;}catch(e){if(child.exitCode!==null)throw Error('validator exited');await sleep(500);}}
 for(let i=0;i<100;i++){if(await session.connection.getBalance(payer.publicKey,'confirmed')>1e9&&await session.connection.getSlot('finalized')>3)break;await sleep(300);} results.genesis=await session.connection.getGenesisHash();results.loadedElfs=[];
 for(const [id,file]of [[pk(TOKEN_PROGRAM),paths.token],[E,paths.escrow],[B,paths.buffer]]){
  const info=await session.connection.getAccountInfo(id);if(!info?.executable)throw Error('missing executable');
  let loaded=info.data;if(info.data.readUInt32LE(0)===2){const pd=await session.connection.getAccountInfo(pk(info.data.subarray(4,36)));loaded=pd.data.subarray(45);}
  const expected=await readFile(file);if(!loaded.equals(expected))throw Error(`ELF mismatch ${id}`);results.loadedElfs.push({program:id.toBase58(),sha256:hash(loaded),bytes:loaded.length});
 }
 await session.send('fund-owner-agent',[web3.SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:owner.publicKey,lamports:1e9}),web3.SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:agent.publicKey,lamports:1e9})]);
 const agentDir=resolve(out,'agent-transactions');await mkdir(agentDir,{mode:0o700});
 const agentSession=new LocalSession({web3,endpoint,payer:agent,directory:agentDir});
 const mint=web3.Keypair.generate(), assets={};
 for(const label of ['source','expired','destination','wrong-destination']){
  const dir=resolve(out,label);await mkdir(dir,{mode:0o700});const signer=web3.Keypair.generate(),context=web3.Keypair.generate();
  const request={source:signer.publicKey.toBase58(),mint:mint.publicKey.toBase58(),owner:owner.publicKey.toBase58(),payer:payer.publicKey.toBase58(),context:context.publicKey.toBase58(),amount:['source','expired'].includes(label)?100:0};
  await writeNew(resolve(dir,'request.json'),JSON.stringify(request));await exec(paths.provision,[resolve(dir,'escrow.keys'),resolve(dir,'request.json'),resolve(dir,'plan.json')]);
  const plan=JSON.parse(await readFile(resolve(dir,'plan.json')));assets[label]={dir,signer,plan,key:signer.publicKey};
  if(label==='source')await session.createAccount(mint,plan.mint_size,TOKEN_PROGRAM,plan.mint_initialization.map(x=>instructionFromJSON(x,web3)),[],'mint');
  await session.createAccount(signer,plan.token_size,TOKEN_PROGRAM,[instructionFromJSON(plan.initialize,web3)],[],`initialize-${label}`);
  await verifyPreparedProof(session,plan.configuration,context);await session.send(`configure-${label}`,[instructionFromJSON(plan.configuration.configure_instruction,web3)],[owner]);
  if(plan.funding.length)await session.send(`fund-${label}`,plan.funding.map(x=>instructionFromJSON(x,web3)),[owner]);
  if(['source','expired'].includes(label))await session.send(`lock-credits-${label}`,plan.disable_credits.map(x=>instructionFromJSON(x,web3)),[owner]);
 }
 await session.send('disable-mint-authority',[instructionFromJSON(assets.source.plan.finalize_mint,web3)]);
 const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;}, meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
 const action=createHash('sha256').update('permissions-probe:record-confidential-execution:v1').digest();
 async function grant(asset,expires){
  const [g]=web3.PublicKey.findProgramAddressSync([Buffer.from('grant'),asset.key.toBuffer()],E);asset.grant=g;
  const ix=new web3.TransactionInstruction({programId:E,keys:[meta(g,false,true),meta(owner.publicKey,true,true),meta(asset.key,false,true),meta(mint.publicKey),meta(assets.destination.key),meta(pk(TOKEN_PROGRAM)),meta(web3.SystemProgram.programId)],data:Buffer.concat([Buffer.from([0]),agent.publicKey.toBuffer(),action,u64(expires),u64(3)])});
  const receipt=await session.send(`grant-${asset===assets.source?'source':'expired'}`,[ix],[owner]);check('owner-authorized-grant',{signature:receipt.signature,grant:g.toBase58(),expiry:expires});
 }
 async function prepare(asset,label,amount,authority=asset.grant,destination=assets.destination){
  const dir=resolve(out,label);await mkdir(dir,{mode:0o700});const contexts=Object.fromEntries(['equality','grouped','range'].map(k=>[k,web3.Keypair.generate()]));
  const raw=await session.connection.getAccountInfo(asset.key);await writeNew(resolve(dir,'source.bin'),raw.data);
  const request={source:asset.key.toBase58(),mint:mint.publicKey.toBase58(),destination:destination.key.toBase58(),owner:authority.toBase58(),amount,destination_elgamal_pubkey:destination.plan.elgamal_pubkey,...Object.fromEntries(Object.entries(contexts).map(([k,v])=>[k,v.publicKey.toBase58()]))};
  await writeNew(resolve(dir,'request.json'),JSON.stringify(request));
  await exec(paths.prover,['prepare-transfer','--keys',resolve(asset.dir,'escrow.keys'),'--request',resolve(dir,'request.json'),'--source-account',resolve(dir,'source.bin'),'--output',resolve(dir,'prepared.json'),'--witness',resolve(dir,'witness.bin')]);
  const prepared=JSON.parse(await readFile(resolve(dir,'prepared.json')));const proofSession=new LocalSession({web3,endpoint,payer:agent,directory:dir});await verifyTransferProofs(proofSession,prepared,contexts,{bufferProgram:B.toBase58()});
  return {prepared,contexts,native:instructionFromJSON(prepared.native_instruction,web3)};
 }
 function execute(asset,p,nonce=0,destination=assets.destination.key,semantic=action){return new web3.TransactionInstruction({programId:E,keys:[meta(asset.grant,false,true),meta(agent.publicKey,true),meta(asset.key,false,true),meta(mint.publicKey),meta(destination,false,true),...['equality','grouped','range'].map(k=>meta(p.contexts[k].publicKey)),meta(pk(TOKEN_PROGRAM))],data:Buffer.concat([Buffer.from([1]),u64(nonce),semantic,p.native.data])});}
 async function snapshot(label){const keys=[assets.source.key,assets.expired.key,assets.destination.key,assets['wrong-destination'].key,...Object.values(assets).filter(a=>a.grant).map(a=>a.grant)];const value=await session.connection.getMultipleAccountsInfoAndContext(keys,'confirmed');const snap={slot:value.context.slot,accounts:value.value.map((a,i)=>({address:keys[i].toBase58(),owner:a.owner.toBase58(),dataBase64:a.data.toString('base64'),sha256:hash(a.data)}))};await writeNew(resolve(out,`${label}.json`),JSON.stringify(snap));return snap.accounts.map(a=>a.sha256);}
 async function reject(label,ix,code,additionalSigners=[]){
  const before=await snapshot(`${label}-before`);const latest=await agentSession.connection.getLatestBlockhash();const tx=new web3.VersionedTransaction(new web3.TransactionMessage({payerKey:agent.publicKey,recentBlockhash:latest.blockhash,instructions:[web3.ComputeBudgetProgram.setComputeUnitLimit({units:600000}),ix]}).compileToV0Message());tx.sign([agent,...additionalSigners]);
  const sim=await agentSession.connection.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed'});if(!sim.value.err)throw Error(`${label} accepted`);if(code!==undefined&&!JSON.stringify(sim.value.err).includes(`"Custom":${code}`))throw Error(`${label} wrong error ${JSON.stringify(sim.value.err)}`);
  const sig=await agentSession.connection.sendRawTransaction(tx.serialize(),{skipPreflight:true,maxRetries:5});let landed;for(let i=0;i<100;i++){landed=await agentSession.connection.getTransaction(sig,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(landed)break;await sleep(200);}if(!landed?.meta?.err)throw Error(`${label} missing landed rejection`);
  const after=await snapshot(`${label}-after`);if(JSON.stringify(before)!==JSON.stringify(after))throw Error(`${label} changed effect state`);
  await writeNew(resolve(out,`${label}-failure.json`),JSON.stringify({classification:'actual-signed-landed-failure',signature:sig,signedTransactionBase64:Buffer.from(tx.serialize()).toString('base64'),simulation:sim.value,transaction:landed,accountsUnchanged:true}));check(label,{signature:sig,error:landed.meta.err,accountsUnchanged:true});
 }
 await grant(assets.source,(await session.connection.getSlot())+2000);
 const p=await prepare(assets.source,'agent-fresh-60',60);await snapshot('execution-before');
 await reject('wrong-recipient',execute(assets.source,p,0,assets['wrong-destination'].key),907);
 const bad=Buffer.from(action);bad[0]^=1;await reject('wrong-action',execute(assets.source,p,0,assets.destination.key,bad),908);
 const paid=await agentSession.send('agent-only-spend-60',[execute(assets.source,p)]);if(paid.transaction.transaction.message.header.numRequiredSignatures!==1)throw Error('unexpected signer count');check('agent-only-native-transfer',{signature:paid.signature,ownerExecutionSignatureAbsent:true});
 const final=await session.connection.getAccountInfo(assets.source.grant);if(final.data.readBigUInt64LE(1)!==1n)throw Error('effect counter');
 const source=await session.connection.getAccountInfo(assets.source.key);if(!source.data.includes(Buffer.from(p.prepared.expected_new_source_ciphertext,'hex')))throw Error('native ciphertext not applied');await snapshot('execution-after');
 await reject('execution-replay',execute(assets.source,p),906);
 await reject('overspend-stale-funding-proof',execute(assets.source,p,1));
 let rejected=false;try{await prepare(assets.source,'fresh-overspend-60',60);}catch(e){if(!String(e).includes('insufficient available balance'))throw e;rejected=true;}if(!rejected)throw Error('overspend proof prepared');check('fresh-overspend-proof-builder-rejection',{evidence_level:'client-only'});
 // Incoming credits remain disabled; a fresh owner proof cannot renew the grant.
 const topup=await prepare(assets.expired,'attempt-topup',1,owner.publicKey,assets.source);await reject('topup-cannot-renew',topup.native,undefined,[owner]);
 // Revoke atomically returns native authority; recovery uses the grantor's saved dedicated key.
 const revoke=new web3.TransactionInstruction({programId:E,keys:[meta(assets.source.grant,false,true),meta(owner.publicKey,true),meta(assets.source.key,false,true),meta(pk(TOKEN_PROGRAM))],data:Buffer.from([2])});
 const revoked=await session.send('revoke-and-recover-authority',[revoke],[owner]);check('owner-revocation',{signature:revoked.signature});await reject('revoked-grant',execute(assets.source,p,1),905);
 const refund=await prepare(assets.source,'owner-fresh-refund-40',40,owner.publicKey);const refunded=await session.send('owner-refund-40',[refund.native],[owner]);check('honest-owner-refund',{signature:refunded.signature});
 await grant(assets.expired,(await session.connection.getSlot())+8);const expired=await prepare(assets.expired,'expired-fresh-60',60);const expiry=(await session.connection.getAccountInfo(assets.expired.grant)).data.readBigUInt64LE(9);while(BigInt(await session.connection.getSlot())<expiry)await sleep(300);
 await reject('expired-grant',execute(assets.expired,expired),904);
 await snapshot('final');results.passed=true;await writeNew(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS',out);
}catch(error){results.error=String(error.stack??error);await writeNew(resolve(out,'failed.json'),JSON.stringify(results,null,2));throw error;}
finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await log.close();console.log('validator stopped',child.pid);}
