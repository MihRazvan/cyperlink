#!/usr/bin/env node
/** Offline archive review: no RPC, signer files, decryption or fresh execution. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { signedMessage, decodeSnapshot, verifyPaidTransition, verifyRollback, checkState } from '../policies/qualification/archive.mjs';
import { validateOperationPlan } from '../../packages/policy-client/src/operation-plan.mjs';
import { validateOperationTicket } from '../../packages/policy-client/src/operation-ticket.mjs';
import { validateOperation } from '../../packages/policy-client/src/sdk.mjs';
import { verifyUploadedCircuit } from '../../packages/policy-cli/src/circuit-evidence.mjs';
import { TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function reviewLicenseArchive({ resultsPath, instancePath }) {
const input=resolve(resultsPath);
const json=async p=>JSON.parse(await readFile(p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(input),r=JSON.parse(raw);assert.equal(r.passed,true);
assert.equal(resolve(r.instancePath),resolve(instancePath),'Selected instance differs from archived deployment');
const instance=await json(instancePath);assert.deepEqual(instance.descriptor,r.deployment);assert.equal(instance.descriptor.genesisHash,r.genesisHash);
const req=createRequire(resolve(instance.moduleRoot,'package.json'));
const web3=req('@solana/web3.js'), anchor=req('@anchor-lang/core'), ar=req('@arcium-hq/client');
const {convertIdlToCamelCase}=req('@anchor-lang/core/dist/cjs/idl.js');
const b58m=req('bs58'), b58=b58m.default??b58m;
const coder=new anchor.BorshInstructionCoder(await json(instance.idl));
const seen=new Map();let signatures=0;
for(const e of [...r.transactions,...r.callbacks]){
 if(seen.has(e.signature)){assert.deepEqual(e.transaction,seen.get(e.signature).entry.transaction);continue;}
 const decoded=signedMessage(e,web3,b58);signatures+=decoded.signatures;seen.set(e.signature,{entry:e,...decoded});
}
assert.deepEqual(r.signedArchiveChecks,{messages:seen.size,ed25519Signatures:signatures,excludesProvisioningAndDeploymentReceipts:true});
const snaps=new Map(r.accountSnapshots.map(s=>[s.label,s]));assert.equal(snaps.size,r.accountSnapshots.length);
const plans=new Map();for(const op of r.operations){const plan=validateOperationPlan(await json(op.planPath));assert.deepEqual(plan.descriptor,op.descriptor);assert.equal(plan.genesisHash,r.genesisHash);plans.set(op.label,plan);}
assert.equal(plans.size,5);assert.equal(r.callbacks.length,5);
const expected=new Map([['cap-rejects-funded40',false],['purchase-a30',true],['competing-b30',true],['fresh-b30-allocation-denial',false],['fresh-compatible20',true]]);
assert.deepEqual([...plans.keys()].sort(),[...expected.keys()].sort());
assert.deepEqual(r.callbacks.map(c=>c.label).sort(),[...expected.keys()].sort(),'Expected one callback per exact operation');
const template=label=>validateOperation(plans.get(label).descriptor).template;
assert.notEqual(template('purchase-a30').source,template('competing-b30').source,'Quota staleness must use independent native sources');
assert.equal(plans.get('purchase-a30').descriptor.quota,plans.get('competing-b30').descriptor.quota);
const repeatedBefore=snaps.get('repeat-query-before'),repeatedAfter=snaps.get('repeat-query-after');
assert(repeatedBefore.context.slot<=repeatedAfter.context.slot);
assert.deepEqual(decodeSnapshot(repeatedBefore),decodeSnapshot(repeatedAfter));
const callbackChecks=[];
for(const cb of r.callbacks){
 const plan=plans.get(cb.label),d=plan.descriptor;assert.equal(cb.job,d.job);assert.equal(cb.computation,d.computation);
 const e=seen.get(cb.signature);assert.equal(e.entry.transaction.meta.err,null);
 const ix=e.instructions.filter(ix=>ix.program===d.deployment.programs.auth);assert.equal(ix.length,1);
 const decoded=coder.decode(ix[0].data);assert.equal(decoded.name,'runtime_policy_evaluate_callback');
 const rawOutput=decoded.data.output.Success[0];
 const output={field0:rawOutput.field_0,field1:rawOutput.field_1,field2:rawOutput.field_2};
 assert.deepEqual(JSON.parse(JSON.stringify(output)),cb.output);
 assert.equal(output.field1,expected.get(cb.label));assert.equal(cb.status,output.field1?1:2);
 assert(Buffer.from(output.field0).equals(validateOperation(d).template.amountCommitment));
 assert(ix[0].accounts.includes(d.job));assert(ix[0].accounts.includes(d.computation));
 const before=snaps.get(cb.label+'-query-before'),after=snaps.get(cb.label+'-callback-after');
 assert(before.context.slot<=cb.slot&&cb.slot<=after.context.slot);
 const b=decodeSnapshot(before),a=decodeSnapshot(after),q0=b.get(d.quota).data,q1=a.get(d.quota).data;
 const business=q=>Buffer.concat([q.subarray(0,88),q.subarray(96)]);
 assert(business(q0).equals(business(q1)));assert.equal(q1.readBigUInt64LE(88),q0.readBigUInt64LE(88)+1n);
 for(const address of [validateOperation(d).template.source,validateOperation(d).template.destination,d.effect])assert.deepEqual(a.get(address),b.get(address));
 if(output.field1){const permit=a.get(d.permit).data;assert(permit.subarray(480,512).equals(Buffer.from(output.field2[0])));assert(permit.subarray(520,616).equals(Buffer.concat(output.field2.slice(1).map(x=>Buffer.from(x)))));}
 callbackChecks.push({label:cb.label,signature:cb.signature,allowed:output.field1,unchangedBusinessState:true,counterAdvancedExactlyOnce:true});
}
const paid=[];
for(const label of ['purchase-a30','fresh-compatible20']){
 const plan=plans.get(label),d=plan.descriptor,t=validateOperation(d).template;
 const entry=r.transactions.find(e=>e.label===label+'-payment');assert(entry);
 const checked=verifyPaidTransition(snaps.get(label+'-payment-before'),snaps.get(label+'-payment-after'),entry,{descriptor:d});
 for(const address of [t.source,t.destination]){assert.equal(checked.before.get(address).owner,'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');assert(!checked.before.get(address).data.equals(checked.after.get(address).data));}
 assert(checked.effect.subarray(8,40).equals(new web3.PublicKey(d.owner).toBuffer()));assert.equal(checked.effect.subarray(40,72).toString('hex'),d.productHex32);assert.equal(checked.effect.readBigUInt64LE(72).toString(),d.licenseExpirySlot);
 const decoded=seen.get(entry.signature);assert(decoded.instructions.some(ix=>ix.program===d.deployment.programs.license&&ix.data[0]===2&&ix.data[41]===0));
 paid.push({label,signature:entry.signature,exactFourSlotSuccessor:true,exactLicenseFields:true,sourceAndDestinationChanged:true});
}
const rejections=[];
for(const [label,code] of [['license-post-native-failure',1199],['stale-predecessor-cannot-pay',803],['issued-license-cannot-pay-twice',1102]]){
 const e=r.transactions.find(e=>e.label===label);assert(e);assert.equal(e.transaction.meta.err.InstructionError[1].Custom,code);
 const plan=plans.get(code===803?'competing-b30':'purchase-a30');
 const instruction=seen.get(e.signature).instructions.find(ix=>ix.program===plan.instructions.commit.program);
 assert(instruction,'Rejection lacks intended consumer invocation');
 const expectedData=Buffer.from(plan.instructions.commit.data,'hex');if(code===1199)expectedData[41]=1;
 assert(instruction.data.equals(expectedData));assert.deepEqual(instruction.accounts,plan.instructions.commit.accounts.map(a=>a.key));
 const n=verifyRollback(snaps.get(label+'-before'),snaps.get(label+'-after'),e);
 if(code===1199){const ix=seen.get(e.signature).instructions.find(ix=>ix.program===r.deployment.programs.license);assert.equal(ix.data[41],1);const logs=e.transaction.meta.logMessages;assert(logs.some(x=>x.includes('ConfidentialTransferInstruction::Transfer')));assert(logs.includes('Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success'));}
 rejections.push({label,code,signature:e.signature,unchangedAccounts:n});
}
const tickets=[];
for(const t of r.tickets){
 const plan=plans.get(t.label),op=r.operations.find(o=>o.label===t.label),ticket=await json(resolve(dirname(op.planPath),t.role+'-ticket.json'));
 const record=await json(resolve(ticket.journalDirectory,t.signature+'.signed.json'));
 assert.equal(record.role,t.role);assert.equal(ticket.signature,t.signature);assert.equal(ticket.wireSha256,t.wireSha256);
 const landed=seen.get(t.signature);assert(landed);assert.equal(landed.entry.transaction.meta.err,null);
 const tx=web3.VersionedTransaction.deserialize(Buffer.from(record.wireBase64,'base64'));
 assert(Buffer.from(tx.message.serialize()).equals(Buffer.from(landed.message.serialize())));assert.deepEqual(tx.signatures.map(s=>b58.encode(s)),landed.entry.transaction.transaction.signatures);
 assert.deepEqual(record.loadedAddresses,landed.entry.transaction.meta.loadedAddresses);
 const loaded=record.loadedAddresses,tables=new Map();let w=0,ro=0;
 for(const lookup of tx.message.addressTableLookups){const addresses=[];for(const i of lookup.writableIndexes)addresses[i]=new web3.PublicKey(loaded.writable[w++]);for(const i of lookup.readonlyIndexes)addresses[i]=new web3.PublicKey(loaded.readonly[ro++]);tables.set(lookup.accountKey.toBase58(),{context:{slot:landed.entry.slot},value:{key:lookup.accountKey,state:{addresses}}});}
 const pa=t.semanticBinding.preparedAction;
 const binding=await validateOperationTicket(plan,record,web3,{
  getAddressLookupTable:async key=>{assert(tables.has(key.toBase58()));return tables.get(key.toBase58());},
  getAccountInfoAndContext:async(key,config)=>{assert(pa);assert.equal(key.toBase58(),pa.address);assert(pa.slot>=config.minContextSlot);return{context:{slot:pa.slot},value:{owner:new web3.PublicKey(pa.owner),executable:pa.executable,data:Buffer.from(pa.dataBase64,'base64')}};}
 });
 assert.deepEqual(binding,t.semanticBinding);tickets.push({label:t.label,role:t.role,signature:t.signature,wireSha256:record.wireSha256});
}
assert.equal(tickets.length,7);
assert.deepEqual(tickets.map(t=>`${t.label}:${t.role}`).sort(),
 [...expected.keys()].map(label=>`${label}:query`).concat(['purchase-a30:commit','fresh-compatible20:commit']).sort(),
 'Expected exactly five query and two distinct payment tickets');
const repeatedQueries=r.appInvocations.filter(i=>i.label==='purchase-a30'&&i.command==='approve-query');
assert.equal(repeatedQueries.length,2);
const repeatedSignature=tickets.find(t=>t.label==='purchase-a30'&&t.role==='query').signature;
for(const invocation of repeatedQueries){assert.equal(invocation.exitCode,0);assert.equal(invocation.summary.signature,repeatedSignature);}
const faultEvents={};for(const mode of ['lost-ack','unavailable-receipt'])faultEvents[mode]=(await readFile(resolve(dirname(input),mode+'.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(r.injectedFaults.map(f=>[f.mode,f.events]),Object.entries(faultEvents));
for(const invocation of r.appInvocations.filter(i=>i.faultInjected)){assert.notEqual(invocation.exitCode,0);assert.equal(invocation.summary.paymentCommitted,false);assert.equal(invocation.summary.outcome,'unresolved');}
assert.equal(r.appInvocations.filter(i=>i.faultInjected).length,2);
const lost=faultEvents['lost-ack'].filter(e=>e.fault==='actual-send-response-lost');assert.equal(lost.length,1);const payment=tickets.find(t=>t.label==='purchase-a30'&&t.role==='commit');assert.equal(lost[0].signature,payment.signature);assert.equal(lost[0].wireSha256,payment.wireSha256);
assert(faultEvents['lost-ack'].some(e=>e.fault==='receipt-unavailable'));assert(faultEvents['unavailable-receipt'].some(e=>e.fault==='receipt-unavailable'));
assert.notEqual(lost[0].processId,faultEvents['unavailable-receipt'][0].processId);
const recoveries=[];
for(const invocation of r.appInvocations.filter(i=>i.command==='recover'&&i.exitCode===0&&i.summary.paymentCommitted)){
 const worker=await json(invocation.summary.report),plan=plans.get(invocation.label),t=tickets.find(t=>t.label===invocation.label&&t.role==='commit');assert.equal(worker.createsNewSignedTransaction,false);assert.equal(worker.generatesKeysProofsOrOperationIdentity,false);assert.equal(worker.action,'recover-ticket');assert.equal(worker.delivery.signature,t.signature);assert.equal(worker.delivery.wireSha256,t.wireSha256);assert.equal(worker.observation.status,'committed');assert.equal(worker.retainedPlan.sha256,sha(await readFile(r.operations.find(o=>o.label===invocation.label).planPath)));assert.notEqual(worker.processId,lost[0].processId);for(const key of ['job','computation','permit','owner','quota','effect'])assert.equal(worker.identity[key],plan.descriptor[key]);recoveries.push({label:invocation.label,processId:worker.processId,signature:t.signature});
}
assert.equal(recoveries.length,2);
assert.equal(new Set(recoveries.map(w=>w.processId)).size,2);
assert.equal(r.finalState.quota,r.deployment.quota);
const q=Buffer.from(r.finalState.dataBase64,'base64');checkState(q,r.deployment);assert.equal(q.readBigUInt64LE(0),2n);assert.equal(q.readBigUInt64LE(88),6n);
assert(q.equals(decodeSnapshot(snaps.get('fresh-compatible20-payment-after')).get(r.finalState.quota).data));
const expectedPrograms=[...['auth','policy','guard','merchant','license','proofBuffer'].map(name=>r.deployment.programs[name]),
 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ','ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq',
 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95',TOKEN_PROGRAM];
// Token-2022's exact identity comes from the same pinned runtime constant used by
// the native client; do not accept a ten-entry list containing duplicate programs.
assert.equal(new Set(expectedPrograms).size,10);
assert.deepEqual(r.loadedPrograms.map(p=>p.program).sort(),expectedPrograms.sort(),'Loaded program identity set differs');
for(const p of r.loadedPrograms){assert.equal(p.matched,true);assert.equal(p.genesis_hash,r.genesisHash);assert.equal(p.elf_sha256,sha(await readFile(p.local_elf_path)));assert.equal(p.elf_sha256,p.loaded_elf_sha256);}
const circuitChecks=[];
assert.deepEqual(r.circuitArtifacts.map(c=>c.circuit).sort(),['runtime_policy_evaluate','runtime_policy_init'],'Expected exactly two distinct circuit artifacts');
for(const c of r.circuitArtifacts){
 const artifacts=resolve(instance.releaseDirectory,'circuits');
 const bytes=await readFile(resolve(artifacts,c.circuit+'.arcis')),interfaceBytes=await readFile(resolve(artifacts,c.circuit+'.idarc'));
 const accounts=[c.definition,...c.rawAccounts];for(const a of accounts){const data=Buffer.from(a.dataBase64,'base64');assert.equal(data.length,a.dataLength);assert.equal(sha(data),a.dataSha256);}
 const checked=await verifyUploadedCircuit({ar,arcium:{programId:new web3.PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ'),coder:{accounts:new anchor.BorshAccountsCoder(convertIdlToCamelCase(ar.ARCIUM_IDL))}},definition:new web3.PublicKey(c.definition.address),payer:new web3.PublicKey(c.uploadAuthority),bytes,interfaceBytes,connection:{getMultipleAccountsInfoAndContext:async(keys,config)=>{assert.equal(config.commitment,'confirmed');assert.deepEqual(keys.map(k=>k.toBase58()),accounts.map(a=>a.address));return{context:{slot:c.contextSlot},value:accounts.map(a=>({owner:new web3.PublicKey(a.owner),executable:a.executable,data:Buffer.from(a.dataBase64,'base64')}))};}}});assert.deepEqual(checked,c);circuitChecks.push({circuit:c.circuit,sha256:c.circuitSha256,bytes:c.circuitLength});
}
const report={schema:1,passed:true,evidenceLevel:'independent-offline-license-app-archive-review',input:{path:relative(ROOT,input),sha256:sha(raw),bytes:raw.length},counts:{messages:seen.size,ed25519Signatures:signatures,callbacks:callbackChecks.length,paidLicenses:paid.length,rejections:rejections.length,unchangedRejectionAccounts:rejections.reduce((n,e)=>n+e.unchangedAccounts,0),signedTickets:tickets.length,keylessWorkers:recoveries.length,loadedElfReports:r.loadedPrograms.length,circuitByteComparisons:circuitChecks.length},callbacks:callbackChecks,paid,rejections,tickets,recoveries,faultEvents,circuitChecks,repeatedQuery:{signature:repeatedSignature,unchangedAccounts:repeatedBefore.accounts.length},finalQuota:{version:'2',counter:'6'},reviewedSourceHashes:Object.fromEntries(await Promise.all(['examples/license-app/app.mjs','examples/license-app/qualify.mjs','examples/license-app/rpc-fault.mjs','examples/license-app/verify.mjs'].map(async p=>[p,sha(await readFile(resolve(ROOT,p)))]))),limitations:['No signer files opened, network calls, new execution or runtime mutation.','Reuses existing offline snapshot/ticket/circuit primitives; Ed25519 checked with Node crypto.','No independent BLS verification or historical consensus state proofs; archived RPC account/meta/ALT observations remain trusted.','Loaded ELF reports rehashed against local builds; raw loaded ProgramData not independently archived here.','Fault/process IDs are archived local runner evidence, not OS attestations.','Only two explicit receipt-unavailability fault cases, not arbitrary recovery or retransmission qualification.']};
return report;
}

export function parseArguments(args) {
 const options={};
 for(let i=0;i<args.length;i+=2) {
  const key=args[i];
  assert(['--results','--instance','--output'].includes(key)&&args[i+1]&&!args[i+1].startsWith('--')&&!Object.hasOwn(options,key),'Expected unique --results, --instance and --output path arguments');
  options[key]=args[i+1];
 }
 assert(options['--results']&&options['--instance']&&options['--output'],'Require --results, --instance and --output');
 return{resultsPath:resolve(options['--results']),instancePath:resolve(options['--instance']),output:resolve(options['--output'])};
}
async function main() {
 const options=parseArguments(process.argv.slice(2));
 const report=await reviewLicenseArchive(options);
 await writeFile(options.output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({passed:true,output:options.output,counts:report.counts}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
