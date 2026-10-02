import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const sleep = ms => new Promise(done => setTimeout(done, ms));
export const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(x => Buffer.from(x)))).digest();
export const bytes = value => Buffer.from(value, 'hex');
export const le = (value, length=8) => { let n=BigInt(value); const out=Buffer.alloc(length);for(let i=0;i<length;i++){out[i]=Number(n&255n);n>>=8n;}assert.equal(n,0n);return out; };
export const json = async path => JSON.parse(await readFile(path,'utf8'));
export const writeJson = (path,value) => writeFile(path,JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{mode:0o600});
export function businessState(data) { assert.equal(data.length,353);return Buffer.concat([data.subarray(0,88),data.subarray(96)]); }
export async function snapshot(connection,keys,label,evidence,save){
 const unique=[...new Map(keys.map(k=>[k.toBase58(),k])).values()];
 const result=await connection.getMultipleAccountsInfoAndContext(unique,{commitment:'confirmed'});
 const value={label,context:result.context,commitment:'confirmed',accounts:result.value.map((a,i)=>a?{address:unique[i].toBase58(),owner:a.owner.toBase58(),lamports:a.lamports,executable:a.executable,dataBase64:a.data.toString('base64')}:{address:unique[i].toBase58(),absent:true})};
 evidence.accountSnapshots.push(value);await save();return value;
}
export function unchanged(before,after){assert.deepEqual(after.accounts,before.accounts,'Rejected transaction changed an application account');}
export async function callback(client,op,expectedStatus,started,evidence,save){
 const {PublicKey}=client.session.web3,jobKey=new PublicKey(op.plan.descriptor.job),computation=new PublicKey(op.plan.descriptor.computation),connection=client.session.connection;
 let job;for(let i=0;i<720;i++){job=await client.program.account.job.fetch(jobKey);if(job.status!==0)break;await sleep(250);}
 assert.equal(job.status,expectedStatus,`${op.label}: unexpected Job status`);assert(job.computation.equals(computation));
 for(let attempt=0;attempt<100;attempt++){
  for(const entry of await connection.getSignaturesForAddress(jobKey,{limit:30},'confirmed')){
   if(entry.err)continue;const tx=await connection.getTransaction(entry.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
   if(!tx||tx.meta.err||!tx.meta.logMessages?.some(x=>x.includes('Instruction: RuntimePolicyEvaluateCallback')))continue;
   const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
   const ix=tx.transaction.message.compiledInstructions.find(ix=>keys.get(ix.programIdIndex).equals(client.program.programId));if(!ix)continue;
   const decoded=client.program.coder.instruction.decode(Buffer.from(ix.data)),output=decoded?.data?.output?.success?.[0];assert(output,'Missing signed successful runtime output');
   assert(ix.accountKeyIndexes.some(i=>keys.get(i).equals(jobKey))&&ix.accountKeyIndexes.some(i=>keys.get(i).equals(computation)));
   const result={label:op.label,program:client.program.programId.toBase58(),job:jobKey.toBase58(),computation:computation.toBase58(),signature:entry.signature,status:job.status,output,elapsedFromQueueMs:Date.now()-started,slot:tx.slot,landedCU:tx.meta.computeUnitsConsumed,feeLamports:tx.meta.fee,transaction:tx};
   evidence.callbacks.push(result);await save();return{result,instruction: new client.session.web3.TransactionInstruction({programId:client.program.programId,data:Buffer.from(ix.data),keys:ix.accountKeyIndexes.map(i=>({pubkey:keys.get(i),isSigner:tx.transaction.message.isAccountSigner(i),isWritable:tx.transaction.message.isAccountWritable(i)}))})};
  }await sleep(250);
 }throw Error(`${op.label}: no actual authenticated callback receipt`);
}
export function costs(evidence){const totals={};for(const item of [...evidence.transactions,...evidence.callbacks.map(c=>({...c,category:'arcium-signed-callback'}))]){const t=totals[item.category??'application']??={transactions:0,landedCU:0,feeLamports:0};t.transactions++;t.landedCU+=item.landedCU??0;t.feeLamports+=item.feeLamports??0;}return totals;}
