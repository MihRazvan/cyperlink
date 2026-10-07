#!/usr/bin/env node
/** Offline retained service/runtime qualification review. No RPC, signing or decryption. */
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {signedMessage,decodeSnapshot,verifyPaidTransition} from '../examples/policies/qualification/archive.mjs';
import {descriptorDigest,validateOperationPlan} from '../packages/policy-client/src/operation-plan.mjs';
import {expectedOperationInstruction,instructionJSON} from '../packages/policy-client/src/operation-ticket.mjs';
import {validateOperation,reconcileOperation,decodeJob} from '../packages/policy-client/src/sdk.mjs';
import {validateDeployment} from '../packages/policy-client/src/deployment.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p));
/** Optional archived hash comparisons are separate from account/receipt checks. */
export function verifyJournalMaps(archive, signature) {
 const before=archive.recoveryJournalBefore,after=archive.recoveryJournalAfter;
 if(before===undefined&&after===undefined)return{archived:false,verified:false,files:0};
 assert(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after),'Both recovery journal maps must be retained');
 for(const map of[before,after]){
  const names=Object.keys(map);
  assert(names.includes(signature+'.signed.json')&&names.some(name=>name.startsWith(signature+'.attempt-')),'Journal map lacks original signed wire or broadcast attempt');
  for(const[name,digest]of Object.entries(map)){
   assert(name.startsWith(signature+'.')&&!name.includes('/')&&!name.includes('\\'),'Journal map contains another transaction or path');
   assert(/\.(signed|simulation)\.json$|\.(attempt|response)-[1-9][0-9]*\.json$/.test(name),'Unexpected journal record');
   assert(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),'Malformed journal hash');
  }
 }
 assert.deepEqual(after,before,'Journal changed across runtime recovery');
 return{archived:true,verified:true,files:Object.keys(before).length};
}

export async function reviewServiceArchive({instancePath,archiveDirectory}) {
 const dir=resolve(archiveDirectory);instancePath=resolve(instancePath);
const raw=await readFile(resolve(dir,'results.json')),r=JSON.parse(raw);
assert.equal(r.passed,true);assert.equal(r.classification,'real-local-service-runtime-restart');
assert.equal(r.transactions.length,2);assert.equal(r.callbacks.length,2);assert.deepEqual(r.operations.map(op=>op.label),['before-restart','after-restart']);
const instance=await json(instancePath),deployment=validateDeployment(instance.descriptor);
assert.deepEqual(r.deployment,deployment);assert.equal(r.genesisHash,deployment.genesisHash);
const req=createRequire(resolve(instance.moduleRoot,'package.json')),web3=req('@solana/web3.js'),anchor=req('@anchor-lang/core'),ar=req('@arcium-hq/client'),base58=anchor.utils.bytes.bs58;
for(const[name,version]of[['@solana/web3.js','1.99.0'],['@anchor-lang/core','1.2.0'],['@arcium-hq/client','0.15.0']]){
 let directory=dirname(req.resolve(name)),found;
 for(let i=0;i<8&&!found;i++,directory=dirname(directory)){
  try{const manifest=await json(resolve(directory,'package.json'));if(manifest.name===name)found=manifest.version;}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 assert.equal(found,version,`Expected pinned ${name}`);
}
const idl=await json(instance.idl),coder=new anchor.BorshInstructionCoder(idl),definition=idl.instructions.find(i=>i.name==='runtime_policy_evaluate_callback');
assert.equal(idl.address,deployment.programs.auth);assert(definition);
const ARCIUM='Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ',LIGHTHOUSE='L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95',TOKEN='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const inputs=[];async function artifact(path){const bytes=await readFile(path);const result={path:relative(root,resolve(path)),sha256:sha(bytes),bytes:bytes.length};inputs.push(result);return result;}
await artifact(resolve(dir,'results.json'));await artifact(instancePath);await artifact(instance.idl);
const payments=[],callbacks=[];let signatures=0;
const snap=label=>{const matches=r.accountSnapshots.filter(x=>x.label===label);assert.equal(matches.length,1);return matches[0];};
const observe=(descriptor,s)=>{const map=decodeSnapshot(s);return reconcileOperation(descriptor,{slot:s.context.slot,commitment:s.commitment,accounts:[descriptor.job,descriptor.permit,descriptor.quota,descriptor.effect].map(k=>map.get(k))});};
for(const op of r.operations){
 const planPath=resolve(dir,op.label,'operation-plan.json'),plan=await json(planPath);await artifact(planPath);validateOperationPlan(plan);assert.deepEqual(plan.descriptor,op.descriptor);
 const d=plan.descriptor,{template}=validateOperation(d);assert.deepEqual(d.deployment,deployment);
 const before=snap(op.label+'-before-payment'),after=snap(op.label+'-after-payment');
 assert.equal(observe(d,before).status,'authorized');assert.equal(observe(d,after).status,'committed');
 const tx=r.transactions.find(x=>x.label===op.label);assert(tx);
 const archived=signedMessage(tx,web3,base58);signatures+=archived.signatures;
 const expected=expectedOperationInstruction(plan,'commit',web3),message=archived.message;
 const signers=message.staticAccountKeys.slice(0,message.header.numRequiredSignatures).map(k=>k.toBase58()).sort();
 assert.deepEqual(signers,[...new Set([d.admin,...expected.keys.filter(k=>k.isSigner).map(k=>k.pubkey.toBase58())])].sort());assert.equal(message.staticAccountKeys[0].toBase58(),d.admin);
 const lookup=Object.fromEntries(['writable','readonly'].map(kind=>[kind,(tx.transaction.meta.loadedAddresses?.[kind]??[]).map(k=>new web3.PublicKey(k))]));
 const decoded=web3.TransactionMessage.decompile(message,{accountKeysFromLookups:lookup});assert.equal(decoded.instructions.length,2);
 assert.deepEqual(instructionJSON(decoded.instructions[0]),instructionJSON(web3.ComputeBudgetProgram.setComputeUnitLimit({units:1300000})));
 const merged=new Map([[d.admin,{signer:true,writable:true}]]);for(const k of expected.keys){const key=k.pubkey.toBase58(),old=merged.get(key)??{};merged.set(key,{signer:!!old.signer||k.isSigner,writable:!!old.writable||k.isWritable});}
 const expectedJSON=instructionJSON(expected);expectedJSON.accounts=expectedJSON.accounts.map(k=>({key:k.key,...merged.get(k.key)}));assert.deepEqual(instructionJSON(decoded.instructions[1]),expectedJSON);
 const wire=new web3.VersionedTransaction(message,tx.transaction.transaction.signatures.map(s=>base58.decode(s))).serialize(),wireSha256=sha(wire);
 const transition=verifyPaidTransition(before,after,tx,plan);assert.deepEqual(transition.before.get(d.job),transition.after.get(d.job));
 for(const address of[template.source,template.destination]){assert.equal(transition.before.get(address).owner,TOKEN);assert.equal(transition.after.get(address).owner,TOKEN);assert.notEqual(transition.before.get(address).dataBase64,transition.after.get(address).dataBase64);}
 const recoveries=r.api.filter(x=>x.result.id===op.label);assert(recoveries.some(x=>x.action==='recover'),'Missing API recovery');if(op.label==='before-restart')assert(recoveries.some(x=>x.action==='recover-after-full-restart'),'Missing post-restart API recovery');
 for(const step of recoveries){const v=step.result;assert.equal(v.paymentCommitted,true);assert.equal(v.planHash,descriptorDigest(d));assert.equal(v.deliveries.commit.signature,tx.signature);assert.equal(v.deliveries.commit.wireSha256,wireSha256);assert.equal(v.observation.status,'committed');}
 payments.push({label:op.label,signature:tx.signature,slot:tx.slot,wireSha256,signers,exactNativeConsumerInstruction:true,fullEncryptedSuccessorAndPermitTransition:true,paidLicense:true});
 const cb=r.callbacks.find(x=>x.label===op.label);assert.equal(cb.program,deployment.programs.auth);assert.equal(cb.job,d.job);assert.equal(cb.computation,d.computation);assert(cb.slot<=before.context.slot);
 const signed=signedMessage(cb,web3,base58);signatures+=signed.signatures;assert.equal(cb.transaction.meta.err,null);
 const candidates=signed.instructions.map((ix,index)=>({ix,index})).filter(x=>x.ix.program===deployment.programs.auth&&x.ix.data.subarray(0,8).equals(Buffer.from(definition.discriminator)));assert.equal(candidates.length,1);const{ix,index}=candidates[0];
 assert(index>0&&signed.instructions[index-1].program===ARCIUM);assert(signed.instructions.slice(-2).every(x=>x.program===LIGHTHOUSE));
 const auth=new web3.PublicKey(deployment.programs.auth);assert.equal(ix.accounts.length,definition.accounts.length);
 assert.deepEqual(Object.fromEntries(definition.accounts.map((x,i)=>[x.name,ix.accounts[i]])),{arcium_program:ARCIUM,job:d.job,computation_account:d.computation,quota:d.quota,permit:d.permit,policy_program:deployment.programs.policy,admission:web3.PublicKey.findProgramAddressSync([Buffer.from('admission')],auth)[0].toBase58(),mxe_account:ar.getMXEAccAddress(auth).toBase58(),comp_def_account:ar.getCompDefAccAddress(auth,Buffer.from(ar.getCompDefAccOffset('runtime_policy_evaluate')).readUInt32LE()).toBase58(),cluster_account:ar.getClusterAccAddress(0).toBase58(),instructions_sysvar:web3.SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()});
 const output=coder.decode(ix.data).data.output.Success?.[0];assert(output);assert.deepEqual(JSON.parse(JSON.stringify({field0:output.field_0,field1:output.field_1,field2:output.field_2})),cb.output);assert.equal(output.field_1,true);assert(Buffer.from(output.field_0).equals(template.amountCommitment));
 const accounts=decodeSnapshot(before),permit=accounts.get(d.permit).data,job=decodeJob(accounts.get(d.job).data);assert.equal(job.status,1);assert.equal(job.owner,d.owner);assert.equal(job.computation,d.computation);assert.equal(job.permit,d.permit);assert.equal(job.inputsHash.toString('hex'),d.inputsHashHex);assert(job.template.bytes.equals(Buffer.from(d.templateHex,'hex')));
 assert(permit.subarray(480,512).equals(Buffer.from(output.field_2[0])));assert(permit.subarray(520,616).equals(Buffer.concat(output.field_2.slice(1).map(x=>Buffer.from(x)))));
 callbacks.push({label:op.label,signature:cb.signature,slot:cb.slot,exactNativeCommitment:true,runtimePredecessorAndAccounts:true,immutableJobBinding:true,allFourSuccessorCiphertexts:true});
}
const retained=snap('retained-payment-after-runtime-restart'),first=snap('before-restart-after-payment');assert(retained.context.slot>=first.context.slot);assert.deepEqual(retained.accounts,first.accounts);
const q0=decodeSnapshot(snap('before-restart-before-payment')).get(deployment.quota).data,q1=decodeSnapshot(first).get(deployment.quota).data,q2before=decodeSnapshot(snap('after-restart-before-payment')).get(deployment.quota).data,q2=decodeSnapshot(snap('after-restart-after-payment')).get(deployment.quota).data;
const business=b=>Buffer.concat([b.subarray(0,88),b.subarray(96)]);assert(business(q1).equals(business(q2before)));assert.equal(q2before.readBigUInt64LE(88),q1.readBigUInt64LE(88)+1n);assert.equal(q0.readBigUInt64LE(0),0n);assert.equal(q2.readBigUInt64LE(0),2n);assert.equal(r.finalState.version,'2');assert.equal(r.finalState.counter,q2.readBigUInt64LE(88).toString());
const firstRuntime=r.runtime[0].value,resumed=r.runtime.at(-1).value;assert(/^[a-f0-9-]{36}$/.test(firstRuntime.runtime_id));assert.equal(r.runtime.at(-1).action,'resume');assert.equal(firstRuntime.ready,true);assert.equal(resumed.ready,true);assert.equal(firstRuntime.genesis,deployment.genesisHash);assert.equal(resumed.genesis,firstRuntime.genesis);assert.equal(resumed.runtime_id,firstRuntime.runtime_id);assert(r.runtime.some(x=>x.action==='stop'&&x.value.ready===false));assert.deepEqual(Object.keys(resumed.components.services).sort(),['arcium-trusted-dealer','arx-node-0','arx-node-1']);for(const x of Object.values(resumed.components.services))assert.equal(x.running,true);assert.equal(resumed.components.validator.owned,true);
assert.equal(r.serviceProcessIds.length,2);assert.notEqual(...r.serviceProcessIds);
const provenance=resolve(dir,'workspace/provenance'),programs=new Map();for(const filename of await readdir(provenance)){assert(filename.endsWith('.json'));const path=resolve(provenance,filename),p=await json(path);await artifact(path);assert.equal(p.matched,true);assert.equal(p.genesis_hash,deployment.genesisHash);assert.equal(p.elf_sha256,p.loaded_elf_sha256);const elf=await readFile(p.local_elf_path);assert.equal(sha(elf),p.elf_sha256);assert.equal(elf.length,p.elf_bytes);assert.equal(p.evidence_level,'real-local-validator-account-read');const prior=programs.get(p.program)??{program:p.program,elfSha256:p.elf_sha256,bytes:p.elf_bytes,slots:[],reports:0};assert.equal(prior.elfSha256,p.elf_sha256);prior.slots.push(p.rpc_slot);prior.reports++;programs.set(p.program,prior);}
const expectedPrograms=new Set([...Object.values(deployment.programs),TOKEN,ARCIUM,LIGHTHOUSE,'ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq']);
assert.deepEqual([...programs.keys()].sort(),[...expectedPrograms].sort());assert.equal(programs.size,10);for(const p of programs.values()){assert(p.reports>=2,'Need loaded-byte comparisons before and after restart');assert(Math.min(...p.slots)<payments[0].slot);assert(Math.max(...p.slots)>payments[0].slot);assert(Math.max(...p.slots)<payments[1].slot);p.firstObservedSlot=Math.min(...p.slots);p.lastObservedSlot=Math.max(...p.slots);delete p.slots;}
const sourcePaths=['scripts/qualify_service.mjs','scripts/runtime_local.py','packages/service/src/service.mjs','packages/service/src/backend.mjs','packages/service/src/config.mjs','packages/service/src/http.mjs','packages/service-client/src/index.mjs','packages/policy-client/src/policy-session.mjs','packages/policy-client/src/operation-ticket.mjs','packages/policy-client/src/sdk.mjs','examples/policies/qualification/archive.mjs','scripts/verify_loaded_program.py','scripts/verify_service_archive.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha(await readFile(resolve(root,p)))])));
const journals=verifyJournalMaps(r,payments[0].signature);
const report={schema:1,passed:true,evidenceLevel:'independent-offline-local-service-runtime-archive-review',input:inputs[0],genesisHash:deployment.genesisHash,deploymentHash:descriptorDigest(deployment),counts:{plans:2,paymentReceipts:2,callbacks:2,ed25519Signatures:signatures,accountSnapshots:5,unchangedRestartAccounts:first.accounts.length,loadedProgramReports:inputs.filter(x=>x.path.includes('/provenance/')).length,distinctLoadedPrograms:10,retainedAttemptErrors:r.attemptErrors?.length??0},payments,callbacks,quota:{initialVersion:'0',finalVersion:'2',beforeFirstPaymentCounter:q0.readBigUInt64LE(88).toString(),finalCounter:q2.readBigUInt64LE(88).toString()},recovery:{signature:payments[0].signature,wireSha256:payments[0].wireSha256,apiOriginalIdentityChecked:true,sevenTrackedAccountsUnchanged:first.accounts.length===7,sameGenesisAndRuntimeId:true,differentServiceProcessIds:true,journals},loadedProgramProvenance:[...programs.values()],artifacts:inputs,sourceHashes,limitations:['Offline review only: no RPC, runtime changes, signer loading or account/state decryption.','Ed25519 signatures and exact payment instructions are checked. Archived RPC account bytes, receipt metadata and address lookup resolution remain trusted local evidence, not historical consensus proofs.','Callback commitment, four successor ciphertexts, immutable Job, runtime predecessor and exact callback accounts are checked; no independent BLS verification or independent-operator claim.','Loaded-program reports are compared with retained local ELF files. Loaded account bytes were not re-fetched or independently retained in this review; reports represent the runner original RPC comparisons.',journals.verified?'Archived before/after signed-journal hash maps match; historical file contents at those instants remain runner-provided evidence.':'No before/after signed-journal hash maps are retained in results: journal immutability across restart remains a runner assertion, not an independently repeated offline comparison.',`${r.attemptErrors?.length??0} prior attempt errors retained. This review does not infer uninterrupted execution or arbitrary crash, power-loss or disaster-recovery qualification.`,'Only successful license payments were exercised here. Merchant, denial, stale rejection, rollback and RPC outage guarantees belong to earlier separately scoped evidence.','Initial allowance/cap, purchase amounts and inferred remaining balance are declared synthetic test-observer disclosures; this review does not independently decrypt or establish those plaintext values.','Source hashes identify current review-time files, not attestation of bytes loaded by prior service processes.']};
return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [instancePath,archiveDirectory,outputPath,...extra]=process.argv.slice(2);
 assert(instancePath&&archiveDirectory&&outputPath&&!extra.length,'Usage: verify_service_archive.mjs INSTANCE_JSON ARCHIVE_DIRECTORY OUTPUT_JSON');
 const report=await reviewServiceArchive({instancePath,archiveDirectory}),output=resolve(outputPath);
 assert(!report.artifacts.some(artifact=>resolve(root,artifact.path)===output),'Output must not overwrite retained review inputs');
 await mkdir(dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:true,counts:report.counts,output:relative(root,output)}));
}
