#!/usr/bin/env node
/** Real local acceptance harness. Synthetic plaintext amounts are test-observer disclosures. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PolicyOperationClient } from '../../packages/policy-client/src/operation-client.mjs';
import { validateOperation, decodeQuota } from '../../packages/policy-client/src/sdk.mjs';
import { loadSigner, saveSigner, createPrivateRun, writeNew, REPO, loopbackEndpoint } from '../../packages/local-client/src/runtime.mjs';
import { SignedInstructionSender } from '../../packages/local-client/src/transaction-sender.mjs';
import { sleep, sha, bytes, le, json, writeJson, businessState, snapshot, unchanged, callback, costs } from './qualification/evidence.mjs';
const execute=promisify(execFile);

export async function run({deployments,directory,scenario='combined'}){
 assert.equal(scenario,'combined','This matrix qualifies the two coexisting count/reserve examples together');assert.equal(deployments.length,2);
 const instances=await Promise.all(deployments.map(json));assert(instances.every(i=>i.schema===1&&i.passed));
 const endpoint=loopbackEndpoint(instances[0].endpoint);assert.equal(loopbackEndpoint(instances[1].endpoint),endpoint);
 assert.equal(instances[0].descriptor.genesisHash,instances[1].descriptor.genesisHash);
 assert.notEqual(instances[0].descriptor.programs.auth,instances[1].descriptor.programs.auth);assert.notEqual(instances[0].descriptor.mxePublicKeyHex,instances[1].descriptor.mxePublicKeyHex);
 assert.deepEqual(instances[0].descriptor.stateFields.map(f=>f.name),['remaining','purchases']);assert.deepEqual(instances[1].descriptor.stateFields.map(f=>f.name),['remaining','reserve']);
 directory=await createPrivateRun(directory);
 const evidence={schema:1,passed:false,scenario,evidenceLevel:'real-local-validator-and-two-node-Arcium-runtime',genesisHash:instances[0].descriptor.genesisHash,endpoint,
  instanceDescriptors:instances.map(i=>i.descriptor),transactions:[],callbacks:[],accountSnapshots:[],checks:[],operations:[],recoveries:[],
  observerDisclosures:{initialCountState:{remaining:100,purchases:4},initialReserveState:{remaining:100,reserve:70},note:'Synthetic initial/request values and expected successors are observer disclosures and arithmetic inferences, not decryption of live MXE state.'},
  limitations:['Internal examples, no external customer adoption','Two MXEs use the same two local operators','No production or public-network claim','Fees/CU below are validator costs; modeled compiler ACUs and callback latency are separate']};
 async function collectProvisioning(){
  const seen=new Set(evidence.transactions.map(tx=>tx.signature));
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(!entry.isDirectory()||!entry.name.startsWith('operation-'))continue;
   for(const file of await readdir(resolve(directory,entry.name))){
    if(!file.endsWith('-landed.json'))continue;
    const tx=await json(resolve(directory,entry.name,file));if(seen.has(tx.signature))continue;seen.add(tx.signature);
    evidence.transactions.push({...tx,feeLamports:tx.transaction.meta.fee,category:'native-proof-and-operation-provisioning'});
   }
  }
 }
 const save=()=>writeJson(resolve(directory,'results.json'),evidence);await save();
 try{
  const clients=[];
  for(const [index,instance]of instances.entries()){
   const clientDir=await createPrivateRun(resolve(directory,`client-${index}`));
   const options={moduleRoot:instance.moduleRoot,endpoint,payerKeyfile:instance.payerKeyfile,directory:clientDir,idl:instance.idl,proofCli:instance.proofCli,deployment:instance.descriptor,record:async tx=>{evidence.transactions.push(tx);await save();}};
   const bindings=await import(pathToFileURL(resolve(instance.releaseDirectory,'../../bindings.mjs')).href);
   assert.equal(bindings.releaseHashHex,instance.descriptor.releaseHashHex);
   const client=await bindings.connect(options);assert(client instanceof PolicyOperationClient);await client.assertDeploymentState();clients.push(client);
  }
  const [count,reserve]=clients,{PublicKey,Keypair,TransactionInstruction,SystemProgram}=count.session.web3,connection=count.session.connection;
  const pk=x=>new PublicKey(x),otherStates=clients.map(c=>c.Q);
  assert.equal((await connection.getAccountInfo(count.Q)).data.readBigUInt64LE(0),0n);assert.equal((await connection.getAccountInfo(reserve.Q)).data.readBigUInt64LE(0),0n);
  const owners=await Promise.all(instances.map(async i=>({merchant:await loadSigner(resolve(i.assetDirectories.merchant,'source-owner-signer.json'),count.session.web3),license:await loadSigner(resolve(i.assetDirectories.license,'source-owner-signer.json'),count.session.web3)})));
  let nextSku=100;
  async function prepare(clientIndex,label,amount,kind='merchant'){
   const client=clients[clientIndex],instance=instances[clientIndex],dir=resolve(directory,`operation-${label}`);
   const consumer=kind==='merchant'?{kind,sku:String(nextSku++)}:{kind,productHex32:sha(Buffer.from(label)).toString('hex'),expirySlot:String((await connection.getSlot('confirmed'))+950)};
   const plan=await client.prepare({label,directory:dir,provisionedDirectory:instance.assetDirectories[kind],amount,consumer});assert.deepEqual(await client.load(dir),plan);
   const op={client,index:clientIndex,label,amount,kind,directory:dir,plan,owner:owners[clientIndex][kind]};
   evidence.operations.push({label,requestedAmountObserverDisclosure:amount,consumer:kind,planPath:resolve(dir,'operation-plan.json'),descriptor:plan.descriptor});await save();return op;
  }
  function tracked(op,extra=[]){const t=validateOperation(op.plan.descriptor).template;return[t.source,t.destination,t.mint,...op.plan.binding.proofAddresses,op.plan.descriptor.permit,op.plan.descriptor.quota,op.plan.descriptor.effect,op.plan.action,op.plan.descriptor.job,op.plan.descriptor.computation,PublicKey.findProgramAddressSync([Buffer.from('permit-claim'),pk(op.plan.descriptor.permit).toBuffer()],op.client.program.programId)[0].toBase58(),...otherStates.map(k=>k.toBase58()),...extra.map(k=>typeof k==='string'?k:k.toBase58())].map(pk);}
  const snap=(op,label,extra=[])=>snapshot(connection,tracked(op,extra),label,evidence,save);
  async function rejection(op,label,ix,code,{signers=[op.owner],extra=[],sender=op.client.transport,postNative=false}={}){
   const before=await snap(op,`${label}-before`,extra);const result=await sender.send(label,[ix],signers,{expectedError:code,category:'adversarial-landed-failure'});
   const after=await snap(op,`${label}-after`,extra);unchanged(before,after);
   if(postNative)assert(result.transaction.meta.logMessages.some(x=>x.includes('ConfidentialTransferInstruction::Transfer')),'Consumer failure did not reach native CPI');
   evidence.checks.push({label,actualCustomError:code,signature:result.signature,allTrackedAccountsUnchanged:true,postNativeTransfer:postNative});await save();return result;
  }
  function replace(ix,oldKey,newKey){const result=new TransactionInstruction({programId:ix.programId,data:Buffer.from(ix.data),keys:ix.keys.map(k=>({...k,pubkey:k.pubkey.equals(oldKey)?newKey:k.pubkey}))});assert(result.keys.some(k=>k.pubkey.equals(newKey)));return result;}
  function editQuery(client,ix,fields){const decoded=client.program.coder.instruction.decode(ix.data);assert(decoded);return new TransactionInstruction({programId:ix.programId,keys:ix.keys.map(k=>({...k})),data:client.program.coder.instruction.encode(decoded.name,{...decoded.data,...fields})});}
  async function admit(op,{expected=1,instruction=null,sdk=true,afterQueue=async()=>{}}={}){
   await snap(op,`${op.label}-admission-before`);
   const before=(await connection.getAccountInfo(op.client.Q,'confirmed')).data,started=Date.now();
   if(sdk){const ticket=await op.client.stageQuery(op.plan,{owner:op.owner});await writeNew(resolve(op.directory,'query-ticket.json'),JSON.stringify(ticket));await op.client.submit(op.plan,ticket);op.queryTicket=ticket;}
   else await op.client.transport.send(`${op.label}-explicit-adversarial-query`,[instruction],[op.owner],{category:'adversarial-private-query'});
   await afterQueue();const cb=await callback(op.client,op,expected,started,evidence,save);op.callback=cb;
   assert.equal(cb.result.output.field1,expected===1);if(sdk)assert(Buffer.from(cb.result.output.field0).equals(Buffer.from(validateOperation(op.plan.descriptor).template.amountCommitment)));
   await snap(op,`${op.label}-callback-after`);
   const after=(await connection.getAccountInfo(op.client.Q,'confirmed')).data;assert(businessState(before).equals(businessState(after)),'Callback advanced private business state');
   assert(after.readBigUInt64LE(88)>before.readBigUInt64LE(88));
   const check={label:`${op.label}-callback-only-not-paid`,allFourCiphertextsUnchanged:true,admissionCounterAdvanced:true,authorized:expected===1};
   if(sdk){check.observation=await op.client.observe(op.plan);assert.equal(check.observation.status,expected===1?'authorized':'denied');}
   evidence.checks.push(check);await save();return op;
  }
  async function recovery(op,ticket,label,action='recover-ticket',expectedStatus){
   const ticketPath=resolve(directory,`${label}-ticket.json`),out=resolve(directory,`${label}-recovery.json`);await writeNew(ticketPath,JSON.stringify(ticket));
   const args=[resolve(REPO,'packages/policy-client/recover-operation.mjs'),'--plan',resolve(op.directory,'operation-plan.json'),'--rpc',endpoint,'--module-root',instances[op.index].moduleRoot,'--action',action,'--ticket',ticketPath,'--role',ticket.role,'--out',out];if(expectedStatus)args.push('--expect-status',expectedStatus);
   await execute(process.execPath,args,{maxBuffer:1024*1024});const result=await json(out);assert(result.passed&&result.processId!==process.pid);assert.equal(result.createsNewSignedTransaction,false);assert.equal(result.generatesKeysProofsOrOperationIdentity,false);assert.equal(result.delivery.signature,ticket.signature);evidence.recoveries.push({label,...result});await save();return result;
  }
  async function commit(op,{loseResponse=false}={}){
   if(loseResponse)await recovery(op,op.queryTicket,`${op.label}-observer-before-payment`,'recover-ticket','authorized');
   const before=await snap(op,`${op.label}-payment-before`),ticket=await op.client.stageCommit(op.plan,{owner:op.owner});await writeNew(resolve(op.directory,'commit-ticket.json'),JSON.stringify(ticket));
   if(loseResponse){const original=connection.sendRawTransaction.bind(connection);connection.sendRawTransaction=async(...args)=>{await original(...args);throw Error('TEST ONLY: lose actual send acknowledgement');};try{await(await op.client.transport.durable()).send(ticket,{pollAttempts:0});}finally{connection.sendRawTransaction=original;}
    await recovery(op,ticket,`${op.label}-lost-ack-reconcile`);await recovery(op,ticket,`${op.label}-submit-exact-retained`,'submit-ticket','committed');
    const result=await op.client.recover(op.plan,ticket);assert.equal(result.observation.status,'committed');evidence.transactions.push(result.delivery.result);
   }else await op.client.submit(op.plan,ticket);
   const after=await snap(op,`${op.label}-payment-after`),byKey=x=>new Map(x.accounts.map(a=>[a.address,a]));const b=byKey(before),a=byKey(after),d=op.plan.descriptor,t=validateOperation(d).template;
   for(const address of[t.source,t.destination,d.permit,d.quota,d.effect])assert.notEqual(a.get(address).dataBase64,b.get(address).dataBase64,`Paid effect missing for ${address}`);
   const qBefore=decodeQuota(Buffer.from(b.get(d.quota).dataBase64,'base64')),qAfter=decodeQuota(Buffer.from(a.get(d.quota).dataBase64,'base64'));assert.equal(qAfter.version,qBefore.version+1n);assert.equal(qAfter.counter,qBefore.counter);
   const paid=await op.client.observe(op.plan);assert.equal(paid.status,'committed');evidence.checks.push({label:`${op.label}-atomic-native-payment-private-successor-and-entitlement`,observation:paid,lostAcknowledgementInjected:loseResponse});await save();return ticket;
  }
  // Signed low-level validation failures are intentionally distinct from SDK guards.
  const authority=await prepare(0,'authority-and-profile-probes',1),honestIx=await count.queryInstruction(authority.plan),attacker=Keypair.generate();await saveSigner(resolve(directory,'unauthorized-signer.json'),attacker);
  await count.transport.send('fund-local-unauthorized-signer',[SystemProgram.transfer({fromPubkey:count.session.payer.publicKey,toPubkey:attacker.publicKey,lamports:100000000})],[],{category:'adversarial-setup'});
  const attackerSession=Object.create(count.session);attackerSession.payer=attacker;attackerSession.directory=await createPrivateRun(resolve(directory,'attacker-transactions'));const attackerSender=new SignedInstructionSender(attackerSession,async tx=>{evidence.transactions.push(tx);await save();});
  await rejection(authority,'wrong-native-owner-authority',replace(honestIx,authority.owner.publicKey,attacker.publicKey),6001,{signers:[attacker]});
  await rejection(authority,'unauthorized-private-query-administrator',replace(honestIx,count.session.payer.publicKey,attacker.publicKey),6001,{sender:attackerSender});
  await rejection(authority,'foreign-policy-state-instance',replace(honestIx,count.Q,reserve.Q),2004);
  await rejection(authority,'foreign-mxe-domain',replace(honestIx,count.ar.getMXEAccAddress(count.program.programId),reserve.ar.getMXEAccAddress(reserve.program.programId)),2012);
  await rejection(authority,'wrong-computation-definition',replace(honestIx,count.accounts(new count.BN(authority.plan.query.offset)).compDefAccount,reserve.accounts(new reserve.BN(authority.plan.query.offset)).compDefAccount),2012);
  const malformedPermit=Keypair.generate();await saveSigner(resolve(directory,'wrong-size-permit-signer.json'),malformedPermit);
  const allocation=await count.session.createAccount(malformedPermit,744,count.H);evidence.transactions.push({...allocation,feeLamports:allocation.transaction.meta.fee,category:'adversarial-setup'});
  let wrongShape=replace(honestIx,pk(authority.plan.descriptor.permit),malformedPermit.publicKey);
  const originalClaim=PublicKey.findProgramAddressSync([Buffer.from('permit-claim'),pk(authority.plan.descriptor.permit).toBuffer()],count.program.programId)[0],wrongClaim=PublicKey.findProgramAddressSync([Buffer.from('permit-claim'),malformedPermit.publicKey.toBuffer()],count.program.programId)[0];wrongShape=replace(wrongShape,originalClaim,wrongClaim);
  await rejection(authority,'unsupported-successor-permit-length',wrongShape,6002,{extra:[malformedPermit.publicKey,wrongClaim]});
  const nativeProofBad=replace(honestIx,pk(authority.plan.binding.proofAddresses[0]),pk(authority.plan.binding.proofAddresses[1]));await rejection(authority,'wrong-native-proof-context',nativeProofBad,6000);
  const nativeSource=validateOperation(authority.plan.descriptor).template.source;await rejection(authority,'unsupported-native-account-profile',replace(honestIx,pk(nativeSource),attacker.publicKey),6000);

  async function initIx(payer){const offset=new count.BN(randomBytes(8),'le'),acc=count.accounts(offset);return{acc,ix:await count.program.methods.runtimePolicyInit(offset,Array(32).fill(0),new count.BN(0),Array.from({length:4},()=>Array(32).fill(0))).accountsPartial({...acc,payer,compDefAccount:count.ar.getCompDefAccAddress(count.program.programId,Buffer.from(count.ar.getCompDefAccOffset('runtime_policy_init')).readUInt32LE())}).instruction()};}
  for(const[label,payer,sender]of[['unauthorized-initialization',attacker.publicKey,attackerSender],['reinitialization',count.session.payer.publicKey,count.transport]]){const{ix,acc}=await initIx(payer);await rejection(authority,label,ix,6001,{sender,signers:[],extra:[acc.job,acc.computationAccount]});}

  for(const mode of['amount','opening','cipher-domain']){
   const op=await prepare(0,`unbound-${mode}`,1),witness=await json(resolve(op.directory,'operation-witness.json'));let publicKey,nonce,ciphertext;
   const mxe=bytes(op.plan.mxePublicKeyHex),scalar=(1n<<252n)+27742317777372353535851937790883648493n;
   for(let trial=0;trial<4096;trial++){
    const secret=count.ar.x25519.utils.randomSecretKey();publicKey=count.ar.x25519.getPublicKey(secret);nonce=randomBytes(16);const shared=count.ar.x25519.getSharedSecret(secret,mxe);secret.fill(0);
    const cipher=mode==='cipher-domain'?new count.ar.RescueCipher(shared):new count.ar.CSplRescueCipher(shared);
    const opening=count.ar.deserializeLE(Uint8Array.from(witness.opening));ciphertext=cipher.encrypt([mode==='amount'?2n:1n,mode==='opening'?(opening+1n)%scalar:opening],nonce);
    if(mode!=='cipher-domain'||ciphertext.every(ct=>count.ar.deserializeLE(Uint8Array.from(ct))<scalar))break;
    ciphertext=null;
   }assert(ciphertext,'Could not generate serializable wrong-domain ciphertext pair');
   const ix=editQuery(count,await count.queryInstruction(op.plan),{pubkey:[...publicKey],clientNonce:new count.BN(nonce,'le'),amountCt:[...ciphertext[0]],openingCt:[...ciphertext[1]]});await admit(op,{expected:2,instruction:ix,sdk:false});
  }

  const expires=await prepare(0,'expired-private-authorization',1),expiry=(await connection.getSlot('confirmed'))+90;
  const expiryIx=editQuery(count,await count.queryInstruction(expires.plan),{expiry:new count.BN(expiry)});
  await admit(expires,{instruction:expiryIx,sdk:false});
  assert.equal((await count.program.account.job.fetch(pk(expires.plan.descriptor.job))).expiry.toNumber(),expiry);
  console.log('Waiting for the explicitly short-lived test authorization to expire.');
  for(let attempt=0;attempt<400&&(await connection.getSlot('confirmed'))<=expiry;attempt++)await sleep(250);
  assert((await connection.getSlot('confirmed'))>expiry,'Local clock did not reach the test expiry');
  await rejection(expires,'expired-permit-cannot-settle',count.commitInstruction(expires.plan),830);

  const a=await admit(await prepare(0,'count-fifth-purchase',40));
  const delayed=await prepare(0,'counter-delayed-query',1),delayedTicket=await count.stageQuery(delayed.plan,{owner:delayed.owner});await writeNew(resolve(delayed.directory,'query-ticket.json'),JSON.stringify(delayedTicket));
  const b=await prepare(0,'count-competing-license',1,'license');
  await admit(b,{afterQueue:async()=>{const before=await snap(delayed,'counter-drift-before'),original=connection.sendRawTransaction.bind(connection);let delivery;
   connection.sendRawTransaction=(wire,options)=>original(wire,{...options,skipPreflight:true});try{delivery=await(await count.transport.durable()).send(delayedTicket);}finally{connection.sendRawTransaction=original;}
   assert.equal(delivery.status,'failed');assert.equal(delivery.receipt.meta.err.InstructionError[1].Custom,6004);unchanged(before,await snap(delayed,'counter-drift-after'));evidence.transactions.push(count.transport.result(delivery,delayedTicket));evidence.checks.push({label:'signed-counter-only-drift-rejected-before-mpc',actualCustomError:6004,signature:delayedTicket.signature,exactWirePreserved:true});await recovery(delayed,delayedTicket,'counter-drift-recovery','recover-ticket','unobserved');await save();}});

  // Callback replay through an ordinary signer lacks the authenticated Arcium predecessor.
  await rejection(a,'direct-replayed-callback-authentication',a.callback.instruction,9999);
  const foreignCallback=replace(a.callback.instruction,pk(a.plan.descriptor.computation),pk(b.plan.descriptor.computation));await rejection(a,'callback-wrong-computation-association',foreignCallback,6000,{extra:[pk(b.plan.descriptor.job)]});
  const cancelled=await admit(await prepare(0,'cancelled-private-authorization',1));const cancelIx=await count.program.methods.cancel().accounts({owner:cancelled.owner.publicKey,job:pk(cancelled.plan.descriptor.job),permit:pk(cancelled.plan.descriptor.permit),quota:count.Q,policyProgram:count.H,admission:count.admission}).instruction();
  await snap(cancelled,'cancelled-authorization-before');const beforeCancel=businessState((await connection.getAccountInfo(count.Q)).data);await count.transport.send('cancel-without-capacity-consumption',[cancelIx],[cancelled.owner],{category:'cancellation'});assert(businessState((await connection.getAccountInfo(count.Q)).data).equals(beforeCancel));assert.equal((await count.observe(cancelled.plan)).status,'cancelled');await snap(cancelled,'cancelled-authorization-after');
  await rejection(cancelled,'cancelled-permit-cannot-settle',count.commitInstruction(cancelled.plan),700);

  // Every changed semantic action receives its correctly derived consumer PDA.
  const base=count.commitInstruction(a.plan),template=validateOperation(a.plan.descriptor).template;
  async function changedBinding(label,{kind='merchant',destination=template.destination,product=le(a.plan.descriptor.sku),expiry=0}={}){
   const consumer=pk(count.profile[kind]),effect=PublicKey.findProgramAddressSync([Buffer.from(kind==='merchant'?'purchase':'license'),a.owner.publicKey.toBuffer(),product],consumer)[0];
   if(!await connection.getAccountInfo(effect))await count.transport.send(`${label}-create-unissued-effect`,[new TransactionInstruction({programId:consumer,data:Buffer.concat([Buffer.from([0]),product]),keys:[{pubkey:count.session.payer.publicKey,isSigner:true,isWritable:true},{pubkey:a.owner.publicKey,isSigner:true,isWritable:false},{pubkey:effect,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[a.owner],{category:'adversarial-setup'});
   const digest=kind==='merchant'?sha(Buffer.from('merchant-purchase-v1'),effect.toBuffer(),product,a.owner.publicKey.toBuffer(),pk(destination).toBuffer(),pk(template.mint).toBuffer()):sha(Buffer.from('licensed-product-v1'),effect.toBuffer(),product,le(expiry),a.owner.publicKey.toBuffer(),pk(destination).toBuffer(),pk(template.mint).toBuffer());
   const ix=new TransactionInstruction({programId:consumer,keys:base.keys.map(k=>({...k})),data:Buffer.concat(kind==='merchant'?[Buffer.from([1]),product,Buffer.from([0]),bytes(a.plan.binding.nativeDataHex)]:[Buffer.from([2]),product,le(expiry),Buffer.from([0]),bytes(a.plan.binding.nativeDataHex)])});
   ix.keys[7].pubkey=pk(destination);ix.keys[13].pubkey=consumer;ix.keys[14].pubkey=PublicKey.findProgramAddressSync([Buffer.from('cyperlink-action'),digest],consumer)[0];ix.keys[16].pubkey=effect;
   await rejection(a,label,ix,705,{extra:[effect,pk(destination)]});
  }
  const destinationB=validateOperation(b.plan.descriptor).template.destination;
  await changedBinding('changed-recipient-binding',{destination:destinationB});await changedBinding('changed-action-binding',{product:le(nextSku++)});await changedBinding('changed-consumer-binding',{kind:'license',product:sha(Buffer.from('foreign-action')),expiry:(await connection.getSlot('confirmed'))+950});
  const fail=new TransactionInstruction({programId:base.programId,keys:base.keys,data:Buffer.from(base.data)});fail.data[9]=1;await rejection(a,'post-native-consumer-failure-entire-state-rollback',fail,1099,{postNative:true});
  await commit(a,{loseResponse:true});await rejection(b,'competing-private-state-stale',count.commitInstruction(b.plan),803);assert.equal((await count.observe(b.plan)).status,'stale');await rejection(a,'paid-application-replay',base,1001);
  await admit(await prepare(0,'purchase-count-exhausted-with-budget-left',1),{expected:2});
  evidence.observerDisclosures.inferredCountState={remaining:60,purchases:5};

  const reserveDenied=await admit(await prepare(1,'private-reserve-rejects-budget-affordable40',40),{expected:2});evidence.checks.push({label:'budget-only-host-control-would-allow40',evidenceLevel:'observer-arithmetic-control-only',initialBudget:100,requestedAmount:40,remainingIfPaid:60,privateReserve:70,actualPolicyCallbackAllowed:false});
  const reservePaid=await admit(await prepare(1,'private-reserve-compatible-license20',20,'license'));
  const reserveIx=reserve.commitInstruction(reservePaid.plan),transplanted=new TransactionInstruction({programId:reserveIx.programId,keys:reserveIx.keys.map(k=>({...k})),data:Buffer.from(reserveIx.data)});transplanted.keys[0].pubkey=pk(a.plan.descriptor.permit);
  await rejection(reservePaid,'cross-instance-permit-transplant',transplanted,700,{extra:[pk(a.plan.descriptor.permit)]});
  await commit(reservePaid);evidence.observerDisclosures.inferredReserveState={remaining:80,reserve:70};
  assert.equal((await reserve.observe(reserveDenied.plan)).status,'denied');
  evidence.finalStates=await Promise.all(clients.map(async c=>({quota:c.Q.toBase58(),dataBase64:(await connection.getAccountInfo(c.Q,'confirmed')).data.toString('base64')})));
  await collectProvisioning();evidence.validatorCostByCategory=costs(evidence);evidence.passed=true;await save();return evidence;
 }catch(error){await collectProvisioning();evidence.failure={name:error.name,message:error.message,stack:error.stack};evidence.validatorCostByCategory=costs(evidence);await save();throw error;}
}
export function parseArguments(args){const parsed={};for(let i=0;i<args.length;i+=2){assert(args[i]?.startsWith('--')&&args[i+1]);const name=args[i].slice(2);assert(['deployments','out','scenario'].includes(name)&&!parsed[name]);parsed[name]=args[i+1];}assert(parsed.deployments&&parsed.out);return{deployments:parsed.deployments.split(',').map(path=>resolve(path)),directory:resolve(parsed.out),scenario:parsed.scenario??'combined'};}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run(parseArguments(process.argv.slice(2))).then(()=>console.log('Custom policy local acceptance matrix passed.')).catch(error=>{console.error(error);process.exitCode=1;});
