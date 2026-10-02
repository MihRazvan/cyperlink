// Offline validation of retained public evidence; reads no signer or escrow key files.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash,verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadWeb3,writeNew } from '../../packages/local-client/src/runtime.mjs';
const dir=resolve(process.argv[2]), output=resolve(process.argv[3]), web3=await loadWeb3('.local/toolchain/js');
const read=async p=>JSON.parse(await readFile(resolve(dir,p),'utf8'));
const result=await read('results.json');assert.equal(result.passed,true);
const sha=b=>createHash('sha256').update(b).digest('hex');
function archivedMessage(m){return new web3.MessageV0({...m,staticAccountKeys:m.staticAccountKeys.map(k=>new web3.PublicKey(k)),compiledInstructions:m.compiledInstructions.map(i=>({...i,data:Buffer.from(i.data.data??Object.values(i.data))})),addressTableLookups:m.addressTableLookups.map(t=>({...t,accountKey:new web3.PublicKey(t.accountKey)}))});}
let wires=0,signatures=0,failures=0;const signed=[];
async function walk(path){for(const e of await readdir(path,{withFileTypes:true})){if(e.isDirectory()){if(e.name!=='ledger')await walk(resolve(path,e.name));}else if(e.name.endsWith('-signed.json')||e.name.endsWith('-failure.json'))signed.push(resolve(path,e.name));}}
await walk(dir);
for(const path of signed){const r=JSON.parse(await readFile(path));const wire=Buffer.from(r.signedTransactionBase64,'base64');const tx=web3.VersionedTransaction.deserialize(wire);assert.ok(wire.equals(Buffer.from(tx.serialize())));const message=tx.message.serialize();
 for(let i=0;i<tx.message.header.numRequiredSignatures;i++){const spki=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),tx.message.staticAccountKeys[i].toBuffer()]);assert.ok(verify(null,message,{key:spki,format:'der',type:'spki'},tx.signatures[i]));signatures++;}wires++;
 if(r.classification==='actual-signed-landed-failure'){assert.ok(r.transaction.meta.err);assert.deepEqual(r.simulation.err,r.transaction.meta.err);assert.ok(Buffer.from(archivedMessage(r.transaction.transaction.message).serialize()).equals(Buffer.from(message)));failures++;}
}
const failuresExpected=['wrong-recipient','wrong-action','execution-replay','overspend-stale-funding-proof','topup-cannot-renew','revoked-grant','expired-grant'];
for(const label of failuresExpected){const before=await read(`${label}-before.json`),after=await read(`${label}-after.json`);assert.equal(before.accounts.length,after.accounts.length);for(let i=0;i<before.accounts.length;i++){const b=before.accounts[i],a=after.accounts[i];assert.equal(b.address,a.address);assert.equal(b.owner,a.owner);assert.equal(sha(Buffer.from(b.dataBase64,'base64')),b.sha256);assert.equal(sha(Buffer.from(a.dataBase64,'base64')),a.sha256);assert.equal(b.dataBase64,a.dataBase64);}}
const before=await read('execution-before.json'),after=await read('execution-after.json'),final=await read('final.json');
const request=await read('agent-fresh-60/request.json'),prepared=await read('agent-fresh-60/prepared.json');
const get=(snap,key)=>Buffer.from(snap.accounts.find(a=>a.address===key).dataBase64,'base64');
const srcBefore=get(before,request.source),srcAfter=get(after,request.source),grantBefore=get(before,request.owner),grantAfter=get(after,request.owner);
// Initial profile has exactly one CT extension at offset166; type5, body starts170.
assert.equal(srcBefore.readUInt16LE(166),5);assert.equal(srcAfter.readUInt16LE(166),5);
assert.notDeepEqual(srcBefore.subarray(331,395),srcAfter.subarray(331,395));
assert.equal(srcAfter.subarray(331,395).toString('hex'),prepared.expected_new_source_ciphertext);
assert.equal(grantBefore.readBigUInt64LE(1),0n);assert.equal(grantAfter.readBigUInt64LE(1),1n);assert.equal(grantAfter[0],1);
const landed=await read('agent-transactions/000-agent-only-spend-60-landed.json');const signedExecution=await read('agent-transactions/000-agent-only-spend-60-signed.json');
const execution=web3.VersionedTransaction.deserialize(Buffer.from(signedExecution.signedTransactionBase64,'base64'));assert.equal(execution.message.header.numRequiredSignatures,1);
const agent=pk(grantAfter.subarray(57,89)),owner=pk(grantAfter.subarray(25,57));function pk(b){return new web3.PublicKey(b).toBase58();}
assert.equal(execution.message.staticAccountKeys[0].toBase58(),agent);assert.ok(execution.message.staticAccountKeys.every(k=>k.toBase58()!==owner));
assert.equal(landed.transaction.meta.err,null);assert.ok(Buffer.from(archivedMessage(landed.transaction.transaction.message).serialize()).equals(Buffer.from(execution.message.serialize())));assert.ok(landed.transaction.meta.logMessages.some(l=>l.includes('ConfidentialTransferInstruction::Transfer')));
const executionData=Buffer.from(execution.message.compiledInstructions[1].data);assert.equal(grantAfter.subarray(281,313).toString('hex'),sha(Buffer.concat([Buffer.from('cyperlink-permissions-effect-v1'),new web3.PublicKey(request.owner).toBuffer(),executionData.subarray(1)])));
assert.equal(get(final,request.owner)[0],2);assert.equal(pk(get(final,request.source).subarray(32,64)),owner);
const report={schema_version:1,passed:true,scope:'offline checks of archived real-local-validator evidence',genesis:result.genesis,results_sha256:sha(await readFile(resolve(dir,'results.json'))),signed_wires:wires,ed25519_signatures:signatures,landed_failures:failures,unchanged_snapshot_pairs:failuresExpected.length,owner_absent_from_execution_message:true,native_source_successor_exact:true,scoped_effect_counter_and_digest_exact:true,revocation_restored_native_owner:true,limitations:['Historical RPC archives are not independently authenticated bank state proofs','ELF equality is retained runner evidence, not a fresh offline RPC read','Amounts are disclosed test setup; no independent private balance decryption','No distributed computation, priced merchant entitlement, or malicious executor recovery claim']};
await writeNew(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
