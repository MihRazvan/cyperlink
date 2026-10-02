/** Pure offline evidence checks: retained RPC snapshots are not historical consensus proofs. */
import assert from 'node:assert/strict';
import { createHash, verify } from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function rawBytes(value){const values=value?.type==='Buffer'?value.data:Array.isArray(value)?value:Object.values(value??{});assert(Array.isArray(values)&&values.every(x=>Number.isInteger(x)&&x>=0&&x<=255),'Malformed archived instruction bytes');return Buffer.from(values);}
export function signedMessage(entry,web3,base58){
 const receipt=entry.transaction,tx=receipt.transaction,m=tx.message;
 const message=m.staticAccountKeys?new web3.MessageV0({...m,staticAccountKeys:m.staticAccountKeys.map(k=>new web3.PublicKey(k)),compiledInstructions:m.compiledInstructions.map(ix=>({...ix,data:rawBytes(ix.data)})),addressTableLookups:m.addressTableLookups.map(t=>({...t,accountKey:new web3.PublicKey(t.accountKey)}))}):new web3.Message({...m,accountKeys:m.accountKeys.map(k=>new web3.PublicKey(k))});
 const staticKeys=m.staticAccountKeys??m.accountKeys;assert.equal(tx.signatures.length,m.header.numRequiredSignatures);assert(tx.signatures.length>0);assert.equal(entry.signature,tx.signatures[0]);assert.equal(entry.slot,receipt.slot);
 for(let i=0;i<tx.signatures.length;i++){const spki=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),new web3.PublicKey(staticKeys[i]).toBuffer()]);assert(verify(null,message.serialize(),{key:spki,format:'der',type:'spki'},base58.decode(tx.signatures[i])),'Invalid archived Ed25519 signature');}
 const keys=[...staticKeys,...(receipt.meta.loadedAddresses?.writable??[]),...(receipt.meta.loadedAddresses?.readonly??[])];
 return{message,keys,signatures:tx.signatures.length,instructions:(m.compiledInstructions??m.instructions).map(ix=>({program:keys[ix.programIdIndex],accounts:(ix.accountKeyIndexes??ix.accounts).map(i=>{assert(Number.isInteger(i)&&i>=0&&i<keys.length);return keys[i];}),data:m.staticAccountKeys?rawBytes(ix.data):Buffer.from(base58.decode(ix.data))}))};
}
export function decodeSnapshot(snapshot){
 assert.equal(snapshot.commitment,'confirmed');assert(Number.isSafeInteger(snapshot.context?.slot)&&snapshot.context.slot>=0);const map=new Map();
 for(const a of snapshot.accounts){assert(!map.has(a.address));if(a.absent){assert.deepEqual(Object.keys(a).sort(),['absent','address']);map.set(a.address,a);continue;}
  assert.equal(a.executable,false);assert(Number.isSafeInteger(a.lamports)&&a.lamports>=0);const data=Buffer.from(a.dataBase64,'base64');assert.equal(data.toString('base64'),a.dataBase64);map.set(a.address,{...a,data});
 }return map;
}
export function stateHash(data){assert.equal(data.length,353);return createHash('sha256').update(Buffer.concat([Buffer.from('cyperlink-private-state-v1'),data.subarray(257),data.subarray(40,88),data.subarray(161,257)])).digest();}
export function checkState(data,deployment){
 assert.equal(data.length,353);assert.equal(data[128],1);assert(data.subarray(129,161).every(x=>x===0));assert(data.subarray(8,40).equals(stateHash(data)),'Invalid complete ciphertext state hash');
 for(const[offset,name]of[[257,'releaseHashHex'],[289,'schemaHashHex'],[321,'domainHashHex']])assert.equal(data.subarray(offset,offset+32).toString('hex'),deployment[name]);
}
export function verifyRollback(before,after,receipt){
 assert(before.context.slot<=receipt.slot&&receipt.slot<=after.context.slot,'Snapshots do not bracket landed rejection');const b=decodeSnapshot(before),a=decodeSnapshot(after);assert.deepEqual([...b.keys()].sort(),[...a.keys()].sort());for(const[key,value]of b)assert.deepEqual(a.get(key),value,`Rejected transaction changed ${key}`);return b.size;
}
export function verifyPaidTransition(before,after,entry,operation){
 assert.equal(entry.transaction.meta.err,null);assert(before.context.slot<=entry.slot&&entry.slot<=after.context.slot);const b=decodeSnapshot(before),a=decodeSnapshot(after),d=operation.descriptor,program=d.deployment.programs[d.consumerKind];
 const q0=b.get(d.quota),q1=a.get(d.quota),p0=b.get(d.permit),p1=a.get(d.permit),r0=b.get(d.effect),r1=a.get(d.effect);
 for(const q of[q0,q1]){assert.equal(q.owner,d.deployment.programs.policy);checkState(q.data,d.deployment);}
 assert.equal(p0.owner,d.deployment.programs.policy);assert.equal(p1.owner,p0.owner);assert.equal(p0.data.length,712);assert.equal(p1.data.length,712);
 assert.equal(p0.data[0],0);assert.equal(p0.data[1],1);assert.equal(p1.data[0],2);assert(p0.data.subarray(1).equals(p1.data.subarray(1)));
 assert.equal(q1.data.readBigUInt64LE(0),q0.data.readBigUInt64LE(0)+1n);assert.equal(q1.data.readBigUInt64LE(88),q0.data.readBigUInt64LE(88));
 assert(q0.data.subarray(0,8).equals(p1.data.subarray(8,16)));assert(q0.data.subarray(8,40).equals(p1.data.subarray(16,48)));
 assert(q1.data.subarray(8,40).equals(p1.data.subarray(48,80)));assert(q1.data.subarray(40,88).equals(p1.data.subarray(464,512)));assert(q1.data.subarray(161,257).equals(p1.data.subarray(520,616)),'Partial encrypted successor advancement');assert(q1.data.subarray(257).equals(p1.data.subarray(616)));
 assert.equal(r0.owner,program);assert.equal(r1.owner,program);assert(r0.data.every(x=>x===0));assert.equal(r1.data.at(-1),1);assert.equal(r1.data.subarray(0,8).toString(),d.consumerKind==='merchant'?'PURCH001':'LICENSE1');
 for(const address of[d.permit,d.quota,d.effect])for(const key of['owner','executable','lamports'])assert.equal(a.get(address)[key],b.get(address)[key]);
 const t=Buffer.from(d.templateHex,'hex');return{before:b,after:a,template:t,effect:r1.data};
}
