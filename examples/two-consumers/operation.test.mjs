import test from 'node:test';
import assert from 'node:assert/strict';
import { actionTemplate, consumerDigest, sha256, u64, parseQuota, assertSettlementEffect } from './operation.mjs';
const k = n => Buffer.alloc(32, n);

test('consumer effect binds kind, product, owner, destination, mint, and license expiry', () => {
  const input = { record:k(1),product:k(2),expiry:100,owner:k(3),destination:k(4),mint:k(5) };
  const digest = consumerDigest('license',input);
  for (const field of ['record','product','owner','destination','mint']) {
    assert.notDeepEqual(consumerDigest('license',{...input,[field]:k(99)}),digest);
  }
  assert.notDeepEqual(consumerDigest('license',{...input,expiry:101}),digest);
  assert.notDeepEqual(consumerDigest('merchant',{...input,product:u64(7)}),digest);
});

test('immutable native template uses exact ordered keys and natively returned context bytes', () => {
  const input = {source:k(1),mint:k(2),destination:k(3),owner:k(4),sourceData:Buffer.from('current'),
    nativeData:Buffer.from('native'),proofKeys:[k(5),k(6),k(7)],proofData:[Buffer.from('eq'),Buffer.from('grouped'),Buffer.from('range')],
    newSource:Buffer.alloc(64,8),commitment:k(9),quota:k(10),consumer:k(11),consumerContract:k(12)};
  const template=actionTemplate(input); assert.equal(template.length,464);
  assert(template.subarray(208,240).equals(sha256(input.sourceData)));
  assert(template.subarray(240,272).equals(sha256(input.nativeData,input.source,input.mint,input.destination,...input.proofKeys,input.owner,...input.proofData)));
  assert(template.subarray(336,368).equals(input.commitment));
  const swapped=actionTemplate({...input,proofKeys:[k(6),k(5),k(7)]});
  assert(!swapped.subarray(240,272).equals(template.subarray(240,272)));
});

test('settlement observation rejects wrong encrypted successor and a surviving active route', () => {
  const before=Buffer.alloc(161);before[128]=1;
  const after=Buffer.from(before);after.writeBigUInt64LE(1n);after.fill(8,40,88);
  const permit=Buffer.alloc(520);permit[0]=2;permit[1]=1;after.subarray(40,88).copy(permit,464);
  sha256(permit.subarray(464,512)).copy(after,8);
  const record=Buffer.alloc(49);Buffer.from('PURCH001').copy(record);record[48]=1;
  assertSettlementEffect(before,after,permit,record,'merchant');
  const wrong=Buffer.from(after);wrong[50]^=1;
  assert.throws(()=>assertSettlementEffect(before,wrong,permit,record,'merchant'),/successor/);
  wrong[129]=1;assert.throws(()=>parseQuota(wrong),/route/);
});
