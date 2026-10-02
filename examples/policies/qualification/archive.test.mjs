import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { rawBytes, signedMessage, stateHash, checkState, verifyRollback } from './archive.mjs';
const require=createRequire(resolve('.local/toolchain/js/package.json')),web3=require('@solana/web3.js'),bs=require('bs58'),base58=bs.default??bs;
function signedFixture(){const payer=web3.Keypair.generate(),recipient=web3.Keypair.generate().publicKey;const tx=new web3.VersionedTransaction(new web3.TransactionMessage({payerKey:payer.publicKey,recentBlockhash:web3.Keypair.generate().publicKey.toBase58(),instructions:[web3.SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:1})]}).compileToV0Message());tx.sign([payer]);const signatures=tx.signatures.map(sig=>base58.encode(sig));return JSON.parse(JSON.stringify({label:'synthetic-host-signature-fixture-not-runtime',signature:signatures[0],slot:8,transaction:{slot:8,meta:{err:null,loadedAddresses:{writable:[],readonly:[]}},transaction:{signatures,message:tx.message}}}));}
test('offline message reconstruction verifies actual cryptography and rejects altered wire metadata',()=>{
 const fixture=signedFixture();assert.equal(signedMessage(fixture,web3,base58).signatures,1);
 const altered=structuredClone(fixture);const data=altered.transaction.transaction.message.compiledInstructions[0].data;(data.data??data)['4']^=1;assert.throws(()=>signedMessage(altered,web3,base58),/Ed25519/);
 const signature=structuredClone(fixture);signature.transaction.transaction.signatures[0]=base58.encode(Buffer.alloc(64,1));signature.signature=signature.transaction.transaction.signatures[0];assert.throws(()=>signedMessage(signature,web3,base58),/Ed25519/);
});
test('offline state validation covers every extra ciphertext and each identity byte',()=>{
 const data=Buffer.alloc(353);data[128]=1;data.subarray(257,289).fill(1);data.subarray(289,321).fill(2);data.subarray(321).fill(3);stateHash(data).copy(data,8);const deployment={releaseHashHex:data.subarray(257,289).toString('hex'),schemaHashHex:data.subarray(289,321).toString('hex'),domainHashHex:data.subarray(321).toString('hex')};checkState(data,deployment);
 for(let i=161;i<353;i++){const changed=Buffer.from(data);changed[i]^=1;assert.throws(()=>checkState(changed,deployment));}
 const wrongIdentity=Buffer.from(data);wrongIdentity[321]^=1;stateHash(wrongIdentity).copy(wrongIdentity,8);assert.throws(()=>checkState(wrongIdentity,deployment));
});
test('offline rollback rejects snapshots outside receipt interval and newly-created accounts',()=>{
 const before={commitment:'confirmed',context:{slot:4},accounts:[{address:'state',absent:true}]},after={...before,context:{slot:8}};assert.equal(verifyRollback(before,after,{slot:6}),1);
 assert.throws(()=>verifyRollback(before,after,{slot:9}));assert.throws(()=>verifyRollback(before,{...after,accounts:[{address:'state',owner:'owner',lamports:1,executable:false,dataBase64:''}]},{slot:6}));
});
test('archived instruction bytes reject sparse non-byte payloads',()=>{assert.deepEqual(rawBytes({type:'Buffer',data:[1,2]}),Buffer.from([1,2]));assert.throws(()=>rawBytes({0:256}));assert.throws(()=>rawBytes({0:-1}));});
