import test from 'node:test';
import assert from 'node:assert/strict';
import {plan} from './fixture.mjs';
import {reconcileOperation,publicKeyBytes,decodePermit,decodeQuota} from '../src/sdk.mjs';
import {stateHash,sha256} from '../src/codec.mjs';
function fixture(kind='merchant') {
 const p=plan(kind), d=p.descriptor, P=d.deployment.programs, template=Buffer.from(d.templateHex,'hex');
 const quota=Buffer.from(p.quotaSnapshotHex,'hex'), permit=Buffer.alloc(712), job=Buffer.alloc(1200),effect=Buffer.alloc(kind==='merchant'?49:81);
 sha256(Buffer.from('account:Job')).subarray(0,8).copy(job);job[8]=1;
 for(const [offset,key]of [[10,d.owner],[42,d.computation],[74,d.permit]])publicKeyBytes(key).copy(job,offset);
 template.subarray(464,480).copy(job,106);template.subarray(512,520).copy(job,122);template.copy(job,130);Buffer.from(d.inputsHashHex,'hex').copy(job,842);
 const account=(address,owner,data)=>({address,owner,executable:false,data});
 const snapshot={slot:20,commitment:'confirmed',accounts:[account(d.job,P.auth,job),account(d.permit,P.policy,permit),account(d.quota,P.policy,quota),account(d.effect,P[kind],effect)]};
 const authorize=()=>{template.copy(permit);permit[1]=1;job[9]=1;permit[480]=99;permit[550]=88;const v=decodePermit(permit);stateHash(v.successorNonce,v.successorCiphertexts,v.release,v.schema,v.domain).copy(permit,48);};
 const commit=()=>{authorize();permit[0]=2;quota.writeBigUInt64LE(1n);permit.subarray(48,80).copy(quota,8);permit.subarray(464,512).copy(quota,40);permit.subarray(520,616).copy(quota,161);publicKeyBytes(d.owner).copy(effect,8);
  if(kind==='merchant'){effect.write('PURCH001');effect.writeBigUInt64LE(BigInt(d.sku),40);effect[48]=1;}else{effect.write('LICENSE1');Buffer.from(d.productHex32,'hex').copy(effect,40);effect.writeBigUInt64LE(BigInt(d.licenseExpirySlot),72);effect[80]=1;}};
 return {p,d,quota,permit,job,effect,snapshot,authorize,commit};
}
test('custom callback authorizes without advancing business state; complete native effects required',()=>{
 for(const kind of ['merchant','license']){const f=fixture(kind),before=Buffer.from(f.quota);assert.equal(reconcileOperation(f.d,f.snapshot).status,'queued');f.authorize();assert.equal(reconcileOperation(f.d,f.snapshot).status,'authorized');assert.deepEqual(f.quota,before);f.commit();assert.equal(reconcileOperation(f.d,f.snapshot).status,'committed');}
});
test('all four successor slots and release identity must agree even with a recomputed ciphertext hash',()=>{
 for(const offset of [56,161,193,225,257,289,321]){const f=fixture();f.commit();f.quota[offset]^=1;const q=f.quota;stateHash(q.readBigUInt64LE(40),Buffer.concat([q.subarray(56,88),q.subarray(161,257)]),q.subarray(257,289),q.subarray(289,321),q.subarray(321,353)).copy(q,8);assert.throws(()=>reconcileOperation(f.d,f.snapshot));}
});
test('denial cancellation expiry stale and partial settlement remain distinct',()=>{
 for(const [status,expected] of [[2,'denied'],[3,'cancelled'],[4,'invalidated']]){const f=fixture();f.job[9]=status;if(status===3)f.permit[0]=3;assert.equal(reconcileOperation(f.d,f.snapshot).status,expected);}
 const stale=fixture();stale.authorize();stale.quota.writeBigUInt64LE(1n);assert.equal(reconcileOperation(stale.d,stale.snapshot).status,'stale');stale.snapshot.slot=101;assert.equal(reconcileOperation(stale.d,stale.snapshot).status,'expired');
 for(const mutation of [f=>f.effect.fill(0),f=>f.permit[0]=0,f=>f.job[9]=0,f=>f.permit[700]^=1]){const f=fixture();f.commit();mutation(f);assert.throws(()=>reconcileOperation(f.d,f.snapshot));}
});
test('legacy-sized records never silently decode as custom policy state',()=>{assert.throws(()=>decodeQuota(Buffer.alloc(161)));assert.throws(()=>decodePermit(Buffer.alloc(520)));});
