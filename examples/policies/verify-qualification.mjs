#!/usr/bin/env node
/** Offline signed-archive review. This module never opens an RPC connection. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { validateOperationPlan, descriptorDigest } from '../../packages/policy-client/src/operation-plan.mjs';
import { expectedOperationInstruction, instructionJSON } from '../../packages/policy-client/src/operation-ticket.mjs';
import { validatePreparedActionEvidence } from '../../packages/policy-client/src/prepared-action.mjs';
import { validateDeployment, canonicalHash } from '../../packages/policy-client/src/deployment.mjs';
import { validateOperation, decodeJob } from '../../packages/policy-client/src/sdk.mjs';
import { verifyUploadedCircuit } from '../../packages/policy-cli/src/circuit-evidence.mjs';
import { rawBytes, digest, signedMessage, decodeSnapshot, checkState, verifyRollback, verifyPaidTransition } from './qualification/archive.mjs';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const hash=(...parts)=>createHash('sha256').update(Buffer.concat(parts)).digest();
const le=(v,n=8)=>{let x=BigInt(v);const b=Buffer.alloc(n);for(let i=0;i<n;i++){b[i]=Number(x&255n);x>>=8n;}assert.equal(x,0n);return b;};
const field=(value,name)=>value[name]??value[name.replace(/([0-9])$/,'_$1')];
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ARCIUM='Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ',LIGHTHOUSE='L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95',TOKEN='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const FAILURES={
 'wrong-native-owner-authority':6001,'unauthorized-private-query-administrator':6001,'foreign-policy-state-instance':2004,'foreign-mxe-domain':2012,'wrong-computation-definition':2012,
 'unsupported-successor-permit-length':6002,'wrong-native-proof-context':6000,'unsupported-native-account-profile':6000,'unauthorized-initialization':6001,'reinitialization':6001,
 'expired-permit-cannot-settle':830,'direct-replayed-callback-authentication':9999,'callback-wrong-computation-association':6000,'cancelled-permit-cannot-settle':700,
 'changed-recipient-binding':705,'changed-action-binding':705,'changed-consumer-binding':705,'post-native-consumer-failure-entire-state-rollback':1099,'competing-private-state-stale':803,'paid-application-replay':1001,'cross-instance-permit-transplant':700,
};
export async function review({resultsPath,instancePaths,output}){
 assert.equal(instancePaths.length,2);const raw=await readFile(resultsPath),results=JSON.parse(raw);assert(results.passed&&results.scenario==='combined');const instances=await Promise.all(instancePaths.map(json));
 assert(instances.every(i=>i.passed&&i.descriptor.genesisHash===results.genesisHash));
 const require=createRequire(resolve(instances[0].moduleRoot,'package.json')),web3=require('@solana/web3.js'),anchor=require('@anchor-lang/core'),ar=require('@arcium-hq/client'),bs=require('bs58'),base58=bs.default??bs;
 assert.equal(require('@solana/web3.js/package.json').version,'1.99.0');
 const programs=new Map(),deploymentEvidence=[],supplementalEvidence=[];let signatureCount=0,messageCount=0;
 const transactions=new Map();
 function add(entry){const checked=signedMessage(entry,web3,base58),prior=transactions.get(entry.signature);if(prior){assert.deepEqual(prior.checked.message.serialize(),checked.message.serialize());return prior;}signatureCount+=checked.signatures;messageCount++;const value={entry,checked};transactions.set(entry.signature,value);return value;}
 for(const instance of instances){validateDeployment(instance.descriptor);const idl=await json(instance.idl);assert.equal(idl.address,instance.descriptor.programs.auth);programs.set(idl.address,{idl,coder:new anchor.BorshInstructionCoder(idl),instance});const archive=await json(instance.results);assert(archive.passed);deploymentEvidence.push(archive);for(const entry of[...archive.transactions,...archive.callbacks])add(entry);}
 for(const instance of instances){
  for(const directory of Object.values(instance.assetDirectories))for(const name of await readdir(directory))if(name.endsWith('-landed.json'))add({...await json(resolve(directory,name)),category:'native-asset-provisioning'});
  try{const evidence=await json(resolve(dirname(instance.results),'supplemental-deployment-receipts.json'));assert.equal(evidence.genesisHash,results.genesisHash);for(const entry of evidence.transactions)add(entry);supplementalEvidence.push(evidence);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 for(const entry of[...results.transactions,...results.callbacks])add(entry);
 const report={schema:1,passed:false,classification:'offline-custom-policy-signed-archive-review',genesisHash:results.genesisHash,resultsSha256:digest(raw),counts:{},rejections:[],initializers:[],callbacks:[],paidEffects:[],recoveries:[],circuitArtifacts:[],loadedPrograms:[],limitations:[
  'Offline checks of retained confirmed RPC receipts/account snapshots; no fresh RPC reads or independent historical consensus-state proof.',
  'Ed25519 signed messages are independently verified. BLS authenticity rests on successful matched-program onchain verification; this is not a separate offline BLS verifier.',
  'Synthetic initial values and expected plaintext successors are observer inferences; encrypted live state is never decrypted.',
  'Compilation, validator CU/fees and runtime latency remain separate quantities; no production, external adoption or independent-operator claim.'
 ]};
 const snapshots=new Map();for(const s of results.accountSnapshots){assert(!snapshots.has(s.label));decodeSnapshot(s);snapshots.set(s.label,s);}
 const snap=name=>{const value=snapshots.get(name);assert(value,`Missing raw snapshot ${name}`);return value;};
 for(const instance of instances){
  const dep=instance.descriptor,{idl,coder}=programs.get(dep.programs.auth),archive=deploymentEvidence.find(a=>a.descriptor.programs.auth===dep.programs.auth);assert.equal(archive.callbacks.length,1);
  const entry=archive.callbacks[0],checked=transactions.get(entry.signature).checked,definition=idl.instructions.find(i=>i.name==='runtime_policy_init_callback');assert.equal(entry.transaction.meta.err,null);
  const index=checked.instructions.findIndex(ix=>ix.program===dep.programs.auth&&ix.data.subarray(0,8).equals(Buffer.from(definition.discriminator)));assert(index>0&&checked.instructions[index-1].program===ARCIUM);assert(checked.instructions.slice(-2).every(ix=>ix.program===LIGHTHOUSE));
  const ix=checked.instructions[index],accounts=Object.fromEntries(definition.accounts.map((d,i)=>[d.name,ix.accounts[i]])),decoded=coder.decode(ix.data),value=decoded.data.output.Success?.[0]??decoded.data.output.success?.[0];assert.equal(field(value,'field0'),true);
  const first=results.accountSnapshots.find(s=>s.accounts.some(a=>a.address===dep.quota&&!a.absent));assert(first&&first.context.slot>=entry.slot);const state=decodeSnapshot(first).get(dep.quota);assert.equal(state.owner,dep.programs.policy);checkState(state.data,dep);assert.equal(state.data.readBigUInt64LE(0),0n);
  const cipherBytes=Buffer.concat(field(value,'field1').map(ct=>Buffer.from(ct)));assert.equal(cipherBytes.length,128);assert(cipherBytes.equals(Buffer.concat([state.data.subarray(56,88),state.data.subarray(161,257)])),'Initial signed ciphertext outputs differ from retained initialized state');
  const auth=new web3.PublicKey(dep.programs.auth),expected={quota:dep.quota,policy_program:dep.programs.policy,mxe_account:ar.getMXEAccAddress(auth).toBase58(),comp_def_account:ar.getCompDefAccAddress(auth,Buffer.from(ar.getCompDefAccOffset('runtime_policy_init')).readUInt32LE()).toBase58(),admission:web3.PublicKey.findProgramAddressSync([Buffer.from('admission')],auth)[0].toBase58()};for(const[name,address]of Object.entries(expected))assert.equal(accounts[name],address);
  const queue=archive.transactions.filter(t=>t.label==='initialize-private-state');assert.equal(queue.length,1);assert.equal(queue[0].transaction.meta.err,null);const queueIx=transactions.get(queue[0].signature).checked.instructions.find(i=>i.program===dep.programs.auth),queueDef=idl.instructions.find(i=>i.name==='runtime_policy_init'),queueAccounts=Object.fromEntries(queueDef.accounts.map((d,i)=>[d.name,queueIx.accounts[i]]));assert.equal(coder.decode(queueIx.data).name,'runtime_policy_init');for(const name of['job','computation_account','quota','mxe_account','comp_def_account'])assert.equal(queueAccounts[name],accounts[name]);assert.equal(queueAccounts.payer,new web3.PublicKey(state.data.subarray(96,128)).toBase58());
  const writes=entry.transaction.meta.innerInstructions.flatMap(group=>group.instructions).filter(inner=>checked.keys[inner.programIdIndex]===dep.programs.policy&&Buffer.from(base58.decode(inner.data))[0]===2);assert.equal(writes.length,1);assert(Buffer.from(base58.decode(writes[0].data)).equals(Buffer.concat([Buffer.from([2]),state.data.subarray(40,56),cipherBytes])),'Initializer nonce/ciphertext state write differs from authenticated callback');
  report.initializers.push({release:dep.releaseHashHex,signature:entry.signature,allFourCiphertextsChecked:true,initializedStateMatched:true});
 }
 const opMap=new Map();for(const op of results.operations){assert(!opMap.has(op.label));const plan=validateOperationPlan(await json(op.planPath));assert.deepEqual(plan.descriptor,op.descriptor);assert.equal(plan.genesisHash,results.genesisHash);opMap.set(op.label,{op,plan});}
 for(const[label,code]of Object.entries(FAILURES)){
  const entries=results.transactions.filter(t=>t.label===label);assert.equal(entries.length,1,`Missing exact rejection ${label}`);const entry=entries[0];assert.equal(entry.transaction.meta.err?.InstructionError?.[1]?.Custom,code);
  const compared=verifyRollback(snap(label+'-before'),snap(label+'-after'),entry);
  if(code===1099)assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN} success`),'Failure occurred before successful native transfer CPI');
  report.rejections.push({label,signature:entry.signature,slot:entry.slot,customError:code,accountsCompared:compared});
 }
 const delayed=results.transactions.find(t=>t.signature===results.checks.find(c=>c.label==='signed-counter-only-drift-rejected-before-mpc')?.signature);assert(delayed);assert.equal(delayed.transaction.meta.err?.InstructionError?.[1]?.Custom,6004);
 report.rejections.push({label:'counter-only-drift',signature:delayed.signature,customError:6004,accountsCompared:verifyRollback(snap('counter-drift-before'),snap('counter-drift-after'),delayed)});
 const delayedPlan=opMap.get('counter-delayed-query').plan,delayedMap=decodeSnapshot(snap('counter-drift-after'));
 for(const address of[delayedPlan.descriptor.job,delayedPlan.descriptor.computation,web3.PublicKey.findProgramAddressSync([Buffer.from('permit-claim'),new web3.PublicKey(delayedPlan.descriptor.permit).toBuffer()],new web3.PublicKey(delayedPlan.descriptor.deployment.programs.auth))[0].toBase58()])assert(delayedMap.get(address)?.absent,'Rejected delayed query left durable allocation');

 for(const callback of results.callbacks){
  const{op,plan}=opMap.get(callback.label),{idl,coder}=programs.get(plan.descriptor.deployment.programs.auth),checked=transactions.get(callback.signature).checked;
  const definition=idl.instructions.find(i=>i.name==='runtime_policy_evaluate_callback');assert(definition);const matches=checked.instructions.map((ix,index)=>({ix,index})).filter(({ix})=>ix.program===idl.address&&ix.data.subarray(0,8).equals(Buffer.from(definition.discriminator)));assert.equal(matches.length,1);
  const{ix,index}=matches[0];assert(index>0&&checked.instructions[index-1].program===ARCIUM);assert(checked.instructions.slice(-2).every(i=>i.program===LIGHTHOUSE));assert.equal(callback.transaction.meta.err,null);
  const accounts=Object.fromEntries(definition.accounts.map((d,i)=>[d.name,ix.accounts[i]]));assert.equal(ix.accounts.length,definition.accounts.length);
  const dep=plan.descriptor.deployment,auth=new web3.PublicKey(dep.programs.auth),key=new web3.PublicKey(plan.descriptor.job);
  const expected={job:plan.descriptor.job,computation_account:plan.descriptor.computation,quota:dep.quota,permit:plan.descriptor.permit,policy_program:dep.programs.policy,admission:web3.PublicKey.findProgramAddressSync([Buffer.from('admission')],auth)[0].toBase58(),mxe_account:ar.getMXEAccAddress(auth).toBase58(),comp_def_account:ar.getCompDefAccAddress(auth,Buffer.from(ar.getCompDefAccOffset('runtime_policy_evaluate')).readUInt32LE()).toBase58()};for(const[name,address]of Object.entries(expected))assert.equal(accounts[name],address);
  const decoded=coder.decode(ix.data),value=decoded.data.output.Success?.[0]??decoded.data.output.success?.[0];assert(value);const commitment=Buffer.from(field(value,'field0')),allowed=field(value,'field1'),ciphers=field(value,'field2');assert.equal(commitment.length,32);assert.equal(typeof allowed,'boolean');assert(Array.isArray(ciphers)&&ciphers.length===4&&ciphers.every(ct=>Array.isArray(ct)&&ct.length===32&&ct.every(x=>Number.isInteger(x)&&x>=0&&x<=255)));
  assert.deepEqual({field0:[...commitment],field1:allowed,field2:ciphers},{field0:callback.output.field0,field1:callback.output.field1,field2:callback.output.field2});
  const before=snap(op.label+'-admission-before'),after=snap(op.label+'-callback-after'),b=decodeSnapshot(before),a=decodeSnapshot(after),q0=b.get(dep.quota).data,q1=a.get(dep.quota).data;checkState(q0,dep);checkState(q1,dep);
  assert(before.context.slot<=callback.slot&&callback.slot<=after.context.slot);assert(q0.subarray(0,88).equals(q1.subarray(0,88)));assert(q0.subarray(96).equals(q1.subarray(96)));assert.equal(q1.readBigUInt64LE(88),q0.readBigUInt64LE(88)+1n);
  const jobAccount=a.get(plan.descriptor.job);assert.equal(jobAccount.owner,dep.programs.auth);const job=decodeJob(jobAccount.data);assert.equal(job.computation,plan.descriptor.computation);assert.equal(job.status,callback.status);assert.equal(job.status,allowed?1:2);
  assert.equal(job.owner,plan.descriptor.owner);assert.equal(job.permit,plan.descriptor.permit);assert.equal(job.kind,1);
  const native=validateOperation(plan.descriptor).template.amountCommitment;if(allowed||!op.label.startsWith('unbound-'))assert(commitment.equals(Buffer.from(native)));if(op.label.startsWith('unbound-'))assert.equal(allowed,false);
  const queues=[...transactions.values()].filter(({entry,checked})=>entry.transaction.meta.err===null&&checked.instructions.some(i=>i.program===auth.toBase58()&&i.accounts.includes(key.toBase58())&&i.data.subarray(0,8).equals(hash(Buffer.from('global:runtime_policy_evaluate')).subarray(0,8))));assert.equal(queues.length,1,'Require one successful signed query per callback');
  const queueIx=queues[0].checked.instructions.find(i=>i.program===auth.toBase58()),args=coder.decode(queueIx.data).data,get=name=>args[name]??args[name.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())];
  const nonce=jobAccount.data.subarray(106,122),hashInputs=hash(Buffer.from(get('pubkey')),le(get('client_nonce').toString(),16),Buffer.from(get('amount_ct')),Buffer.from(get('opening_ct')),q0.subarray(40,56),q0.subarray(56,88),q0.subarray(161,257),nonce,Buffer.from(native),q0.subarray(257));assert(hashInputs.equals(jobAccount.data.subarray(842,874)),'Job encrypted inputs differ from actual signed query/state');
  const expectedJobTemplate=Buffer.from(plan.descriptor.templateHex,'hex');le(get('expiry').toString()).copy(expectedJobTemplate,512);assert(job.template.bytes.equals(expectedJobTemplate),'Job changed exact authorized action/consumer/identity');
  assert.equal(job.expiry.toString(),get('expiry').toString());assert(Buffer.from(get('expected_query_state')).equals(hash(Buffer.from('cyperlink-policy-query-v1'),q0)));
  const permit=a.get(plan.descriptor.permit);assert.equal(permit.owner,dep.programs.policy);assert.equal(permit.data.length,712);
  if(allowed){assert.equal(permit.data[0],0);assert.equal(permit.data[1],1);assert(permit.data.subarray(464,480).equals(nonce));assert(permit.data.subarray(480,512).equals(Buffer.from(ciphers[0])));assert(permit.data.subarray(520,616).equals(Buffer.concat(ciphers.slice(1).map(x=>Buffer.from(x)))));assert(permit.data.subarray(616).equals(q0.subarray(257)));}else assert(permit.data.every(x=>x===0));
  report.callbacks.push({label:op.label,signature:callback.signature,job:jobAccount.address,allowed,allFourSuccessorCiphertextsChecked:true,businessStateUnchanged:true});
 }
 const expectedDecisions={'unbound-amount':false,'unbound-opening':false,'unbound-cipher-domain':false,'expired-private-authorization':true,'count-fifth-purchase':true,'count-competing-license':true,'cancelled-private-authorization':true,'purchase-count-exhausted-with-budget-left':false,'private-reserve-rejects-budget-affordable40':false,'private-reserve-compatible-license20':true};
 assert.equal(report.callbacks.length,Object.keys(expectedDecisions).length);for(const[label,allowed]of Object.entries(expectedDecisions))assert.equal(report.callbacks.find(c=>c.label===label)?.allowed,allowed);

 for(const label of['count-fifth-purchase','private-reserve-compatible-license20']){
  const{op,plan}=opMap.get(label),entry=results.transactions.find(t=>t.label===label+'-atomic-paid-entitlement');assert(entry);const checked=transactions.get(entry.signature).checked,{before,after,effect}=verifyPaidTransition(snap(label+'-payment-before'),snap(label+'-payment-after'),entry,op);
  const expected=expectedOperationInstruction(plan,'commit',web3),ix=checked.instructions.find(i=>i.program===expected.programId.toBase58());assert(ix);assert(ix.data.equals(expected.data));assert.deepEqual(ix.accounts,expected.keys.map(k=>k.pubkey.toBase58()));
  const template=validateOperation(plan.descriptor).template;for(const address of[template.source,template.destination]){assert.equal(before.get(address).owner,TOKEN);assert.equal(after.get(address).owner,TOKEN);assert(!before.get(address).data.equals(after.get(address).data));}
  assert(effect.subarray(8,40).equals(new web3.PublicKey(plan.descriptor.owner).toBuffer()));assert(effect.subarray(40,effect.length-1).equals(ix.data.subarray(1,op.consumer==='merchant'?9:41)));assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN} success`));
  report.paidEffects.push({label,signature:entry.signature,consumer:op.consumer,exactAction:true,allFourSuccessorCiphertexts:true});
 }
 const tickets=new Map();
 for(const{op,plan}of opMap.values())for(const role of['query','commit']){
  let ticket;try{ticket=await json(resolve(dirname(op.planPath),role+'-ticket.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const offline={rpcEndpoint:results.endpoint,async getGenesisHash(){return results.genesisHash;}};
  const sender=await DurableTransactionSender.open({web3,connection:offline,endpoint:results.endpoint,directory:ticket.journalDirectory}),saved=await sender.read(ticket);
  assert.equal(saved.record.descriptorSha256,descriptorDigest(plan.descriptor));assert.equal(saved.record.role,role);const receipt=transactions.get(ticket.signature);assert(receipt,'Missing retained ticket transaction receipt');assert(Buffer.from(receipt.checked.message.serialize()).equals(saved.message));assert.deepEqual(receipt.entry.transaction.transaction.signatures,saved.signatures);
  assert.deepEqual({writable:receipt.entry.transaction.meta.loadedAddresses?.writable??[],readonly:receipt.entry.transaction.meta.loadedAddresses?.readonly??[]},saved.record.loadedAddresses);
  const expected=expectedOperationInstruction(plan,role,web3),resolved=Object.fromEntries(Object.entries(saved.record.loadedAddresses).map(([name,addresses])=>[name,addresses.map(k=>new web3.PublicKey(k))]));
  const decoded=web3.TransactionMessage.decompile(saved.tx.message,{accountKeysFromLookups:resolved});assert.equal(decoded.instructions.length,2);assert.deepEqual(instructionJSON(decoded.instructions[0]),instructionJSON(web3.ComputeBudgetProgram.setComputeUnitLimit({units:1300000})));
  const merged=new Map([[plan.descriptor.admin,{signer:true,writable:true}]]);for(const meta of expected.keys){const k=meta.pubkey.toBase58(),prior=merged.get(k)??{signer:false,writable:false};merged.set(k,{signer:prior.signer||meta.isSigner,writable:prior.writable||meta.isWritable});}
  const expectedJSON=instructionJSON(expected);expectedJSON.accounts=expectedJSON.accounts.map(meta=>({key:meta.key,...merged.get(meta.key)}));assert.deepEqual(instructionJSON(decoded.instructions[1]),expectedJSON);
  if(role==='query'){
   let retained;for(const snapshot of results.accountSnapshots){const account=snapshot.accounts.find(a=>a.address===plan.action&&!a.absent);if(account&&snapshot.context.slot>=plan.contextSlot){retained={...account,slot:snapshot.context.slot,sha256:digest(Buffer.from(account.dataBase64,'base64'))};break;}}
   assert(retained,'Missing immutable PreparedAction snapshot');validatePreparedActionEvidence(plan,retained);
  }
  assert(!tickets.has(ticket.signature));tickets.set(ticket.signature,{ticket,saved,plan});
 }
 const processes=new Set();for(const worker of results.recoveries){assert(worker.passed&&Number.isInteger(worker.processId)&&worker.processId>0);assert.equal(worker.createsNewSignedTransaction,false);assert.equal(worker.generatesKeysProofsOrOperationIdentity,false);assert.equal(worker.genesisHash,results.genesisHash);
  const retained=tickets.get(worker.delivery.signature);assert(retained);assert.equal(worker.delivery.wireSha256,retained.saved.record.wireSha256);assert.equal(worker.delivery.descriptorSha256,retained.saved.record.descriptorSha256);assert.equal(worker.delivery.role,retained.ticket.role);for(const key of['job','computation','permit','owner','quota','effect'])assert.equal(worker.identity[key],retained.plan.descriptor[key]);processes.add(worker.processId);report.recoveries.push({label:worker.label,processId:worker.processId,signature:worker.delivery.signature,wireSha256:worker.delivery.wireSha256,observation:worker.observation.status});
 }
 assert(processes.size>=3,'Recovery did not cross independent process launches');const lost=report.recoveries.filter(r=>r.label.startsWith('count-fifth-purchase')&&!r.label.endsWith('before-payment'));assert(lost.length>=2&&new Set(lost.map(r=>r.signature)).size===1,'Lost acknowledgement recovery replaced signed transaction');
 const commit=tickets.get(lost[0].signature);assert(commit.saved.broadcasts.some(b=>b.response?.outcome==='error'&&b.response.error.message.includes('lose actual send acknowledgement')),'Missing real send-response loss injection record');

 for(const loaded of results.loadedPrograms){assert(loaded.matched);assert.equal(loaded.genesis_hash,results.genesisHash);assert.equal(digest(await readFile(loaded.local_elf_path)),loaded.elf_sha256);assert.equal(loaded.loaded_elf_sha256,loaded.elf_sha256);const retained=await json(loaded.evidenceFile);assert.deepEqual(retained,Object.fromEntries(Object.entries(loaded).filter(([k])=>k!=='evidenceFile')));report.loadedPrograms.push({program:loaded.program,sha256:loaded.elf_sha256,slot:loaded.rpc_slot});}
 assert.equal(report.loadedPrograms.length,15);assert.equal(new Set(report.loadedPrograms.map(p=>p.program)).size,15);
 for(const role of['auth','policy','guard','merchant','license']){const hashes=instances.map(i=>report.loadedPrograms.find(p=>p.program===i.descriptor.programs[role])?.sha256);assert(hashes.every(Boolean));assert.notEqual(hashes[0],hashes[1],`Configured ${role} ELF was incorrectly reused between deployments`);}
 for(const instance of instances){
  const release=await json(resolve(instance.releaseDirectory,'release.json')),{releaseHashHex,...body}=release;assert.equal(canonicalHash(body),releaseHashHex);assert.equal(releaseHashHex,instance.descriptor.releaseHashHex);assert.equal(release.schemaHashHex,instance.descriptor.schemaHashHex);
  for(const[path,sha256]of Object.entries(release.platformSources)){assert(resolve(ROOT,path).startsWith(ROOT+'/'));assert.equal(digest(await readFile(resolve(ROOT,path))),sha256,`Changed release platform source ${path}`);}
  assert.equal(digest(await readFile(resolve(instance.releaseDirectory,'../../..',release.package.entrypoint))),release.sourceSha256);
  for(const[name,item]of Object.entries(release.artifacts))assert.equal(digest(await readFile(resolve(instance.releaseDirectory,'circuits',name))),item.sha256);
  for(const name of['runtime_policy_init','runtime_policy_evaluate']){
   const evidence=await json(resolve(dirname(instance.results),name+'-uploaded-evidence.json')),definition=new web3.PublicKey(evidence.definition.address),payer=new web3.PublicKey(evidence.uploadAuthority);
   const records=[evidence.definition,...evidence.rawAccounts];for(const record of records){assert.equal(digest(Buffer.from(record.dataBase64,'base64')),record.dataSha256);assert.equal(Buffer.from(record.dataBase64,'base64').length,record.dataLength);}
   assert.equal(definition.toBase58(),ar.getCompDefAccAddress(new web3.PublicKey(instance.descriptor.programs.auth),Buffer.from(ar.getCompDefAccOffset(name)).readUInt32LE()).toBase58());
   const connection={async getMultipleAccountsInfoAndContext(keys){assert.deepEqual(keys.map(k=>k.toBase58()),records.map(r=>r.address));return{context:{slot:evidence.contextSlot},value:records.map(r=>({owner:new web3.PublicKey(r.owner),executable:r.executable,data:Buffer.from(r.dataBase64,'base64')}))};}};
   const arcium=ar.getArciumProgram({connection:{},publicKey:payer}),checked=await verifyUploadedCircuit({connection,ar,arcium,definition,payer,bytes:await readFile(resolve(instance.releaseDirectory,'circuits',name+'.arcis')),interfaceBytes:await readFile(resolve(instance.releaseDirectory,'circuits',name+'.idarc'))});assert.deepEqual(checked,evidence);
   report.circuitArtifacts.push({release:releaseHashHex,circuit:name,sha256:checked.circuitSha256,interfaceSha256:checked.interfaceSha256,registeredComputationUnits:checked.registeredComputationUnits,actualUploadedBytesMatched:true});
  }
 }
 report.validatorCosts={categories:{},programDeploymentIncluded:supplementalEvidence.length===instances.length,exclusions:['Distributed computation infrastructure resource costs','Rent and asset funding, which are not transaction fees']};
 if(!report.validatorCosts.programDeploymentIncluded)report.validatorCosts.exclusions.push('Program buffer write/deployment transaction costs missing for at least one deployment');
 for(const {entry} of transactions.values()){const category=entry.category??'uncategorized';const totals=report.validatorCosts.categories[category]??={transactions:0,landedCU:0,feeLamports:0,failedTransactions:0};totals.transactions++;totals.landedCU+=entry.transaction.meta.computeUnitsConsumed??0;totals.feeLamports+=entry.transaction.meta.fee??0;totals.failedTransactions+=Number(Boolean(entry.transaction.meta.err));}
 report.counts={signedMessages:messageCount,ed25519Signatures:signatureCount,decodedCallbacks:report.callbacks.length,decodedInitializers:report.initializers.length,landedRejections:report.rejections.length,rollbackAccountComparisons:report.rejections.reduce((n,x)=>n+x.accountsCompared,0),paidEffects:report.paidEffects.length,retainedExactTickets:tickets.size,recoveryProcesses:processes.size,loadedElfs:report.loadedPrograms.length,uploadedCircuitArtifacts:report.circuitArtifacts.length};report.passed=true;
 if(output)await import('node:fs/promises').then(fs=>fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert(['--results','--instances','--out'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[i+1];}assert(options['--results']&&options['--instances']&&options['--out']);
 review({resultsPath:resolve(options['--results']),instancePaths:options['--instances'].split(',').map(x=>resolve(x)),output:resolve(options['--out'])}).then(r=>console.log(JSON.stringify({passed:true,counts:r.counts}))).catch(e=>{console.error(e);process.exitCode=1;});
}
