// Direct application ABI integration, adapted after inspecting the shared programs
// and CyperLink's existing ABI encoders/readers. This is NOT independent enforcement.
import { createHash } from 'node:crypto';
export function check(ok, message) { if (!ok) throw Error(message); }
export const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(x => Buffer.from(x)))).digest();
export const hx = x => Buffer.from(x, 'hex');
export const zero = b => b.every(x => x === 0);
export const canonical = x => Array.isArray(x) ? `[${x.map(canonical).join(',')}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}` : JSON.stringify(x);
export const digest = x => hash(Buffer.from(canonical(x))).toString('hex');
export function le(x, n = 8) { let v = BigInt(x); check(v >= 0n && v < 1n << BigInt(n * 8), 'Unsigned integer overflow'); const b = Buffer.alloc(n); for (let i = 0; i < n; i++, v >>= 8n) b[i] = Number(v & 255n); return b; }
export const stateHash = (nonce, ciphertexts, identity) => hash(Buffer.from('cyperlink-private-state-v1'), identity, nonce, ciphertexts);
export function quota(b, d, pk) {
  check(b.length === 353 && b[128] === 1 && zero(b.subarray(129, 161)), 'Invalid initialized unarmed policy state');
  check(b.subarray(257).equals(Buffer.concat([hx(d.releaseHashHex), hx(d.schemaHashHex), hx(d.domainHashHex)])), 'Policy identity changed');
  const ciphertexts = Buffer.concat([b.subarray(56, 88), b.subarray(161, 257)]);
  check(b.subarray(8, 40).equals(stateHash(b.subarray(40, 56), ciphertexts, b.subarray(257))), 'Policy ciphertext hash mismatch');
  return { version: b.readBigUInt64LE(), counter: b.readBigUInt64LE(88), admin: pk(b.subarray(96, 128)).toBase58(), ciphertexts };
}
export function template(p, sourceData, proofs, d, owner, product, expiry, effect, pk) {
  const key = x => pk(x).toBuffer();
  const t = Buffer.alloc(464), contract = hash(Buffer.from('licensed-product-v1'), key(effect), hx(product), le(expiry), key(owner), key(p.destination), key(p.mint));
  const fields = [[80,key(p.source)],[112,key(p.mint)],[144,key(p.destination)],[176,key(owner)],[208,hash(sourceData)],
    [240,hash(hx(p.native_instruction.data), key(p.source), key(p.mint), key(p.destination), ...p.proofs.map(x=>key(x.context_address)), key(owner), ...proofs)],
    [272,hx(p.expected_new_source_ciphertext)],[336,hx(p.expected_commitment)],[368,key(d.quota)],[400,key(d.programs.license)],[432,contract]];
  for (const [at,b] of fields) b.copy(t,at); return t;
}
export const encodeIx = ix => ({ program: ix.programId.toBase58(), data: ix.data.toString('hex'), accounts: ix.keys.map(k=>({key:k.pubkey.toBase58(),signer:k.isSigner,writable:k.isWritable})) });
export function decodeIx(ix,w) { return new w.TransactionInstruction({programId:new w.PublicKey(ix.program),data:hx(ix.data),keys:ix.accounts.map(k=>({pubkey:new w.PublicKey(k.key),isSigner:k.signer,isWritable:k.writable}))}); }
export function accountsFor(c, p) {
  const { ar, program, BN, pk, payer } = c, offset = new BN(p.query.offset), d=p.deployment;
  return { payer: pk(p.admin ?? payer.publicKey), job:c.pda(program.programId,Buffer.from('job'),offset.toArrayLike(Buffer,'le',8)),quota:pk(d.quota),policyProgram:pk(d.programs.policy),
    admission:c.pda(program.programId,Buffer.from('admission')),computationAccount:ar.getComputationAccAddress(0,offset),clusterAccount:ar.getClusterAccAddress(0),mxeAccount:ar.getMXEAccAddress(program.programId),
    mempoolAccount:ar.getMempoolAccAddress(0),executingPool:ar.getExecutingPoolAccAddress(0),compDefAccount:ar.getCompDefAccAddress(program.programId,Buffer.from(ar.getCompDefAccOffset('runtime_policy_evaluate')).readUInt32LE()) };
}
export async function queryIx(c,p) {
  const {pk,BN}=c,q=p.query,d=p.deployment,a=accountsFor(c,p);
  check(a.job.toBase58()===p.job && a.computationAccount.toBase58()===p.computation,'Query identity mismatch');
  return c.program.methods.runtimePolicyEvaluate(new BN(q.offset),[...hx(q.publicKey)],new BN(hx(q.nonce),'le'),[...hx(q.amount)],[...hx(q.opening)],new BN(q.expiry),[...hash(Buffer.from('cyperlink-policy-query-v1'),hx(p.quotaSnapshot))])
    .accountsPartial({...a,sourceOwner:pk(p.owner),action:pk(p.action),permit:pk(p.permit),permitClaim:c.pda(pk(d.programs.auth),Buffer.from('permit-claim'),pk(p.permit).toBuffer())})
    .remainingAccounts([p.native.source,p.native.mint,p.native.destination,...p.native.proofs.map(x=>x.context_address),d.programs.license,c.pda(pk(d.programs.policy),Buffer.from('extra-account-metas'),pk(p.native.mint).toBuffer()).toBase58()].map(x=>({pubkey:pk(x),isSigner:false,isWritable:false}))).instruction();
}
export function commitIx(c,p) {
  const {pk}=c,d=p.deployment,n=p.native,t=hx(p.queuedTemplate),consumer=pk(d.programs.license);
  const keys=[p.permit,d.quota,c.pda(pk(d.programs.guard),Buffer.from('guard')),d.programs.policy,'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',n.source,n.mint,n.destination,...n.proofs.map(x=>x.context_address),p.owner,
    c.pda(pk(d.programs.policy),Buffer.from('extra-account-metas'),pk(n.mint).toBuffer()),consumer,c.pda(consumer,Buffer.from('cyperlink-action'),t.subarray(432,464)),d.programs.guard,p.effect];
  return new c.w.TransactionInstruction({programId:consumer,data:Buffer.concat([Buffer.from([2]),hx(p.product),le(p.expiry),Buffer.from([0]),hx(n.native_instruction.data)]),keys:keys.map((x,i)=>({pubkey:pk(x),isSigner:i===11,isWritable:[0,1,5,7,16].includes(i)}))});
}
export function validatePlan(c,p) {
  check(p.schema==='direct-license-v1' && digest(p.deployment)===digest(c.instance.descriptor),'Wrong direct operation/deployment');
  const {pk}=c,d=p.deployment,n=p.native;
  const hex=(x,size)=>typeof x==='string'&&/^(?:[0-9a-f]{2})+$/.test(x)&&(size===undefined||x.length===size*2);
  const decimal=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&BigInt(x)<1n<<64n;
  check(Number.isSafeInteger(p.contextSlot)&&p.contextSlot>=0&&/^[a-z0-9-]{1,64}$/.test(p.label),'Invalid operation context/label');
  check(hex(p.product,32)&&decimal(p.expiry)&&hex(p.quotaSnapshot,353)&&hex(p.queuedTemplate,712)&&hex(p.inputsHash,32)&&hex(p.sourceData),'Noncanonical retained operation encoding');
  check(p.query&&decimal(p.query.offset)&&decimal(p.query.expiry)&&hex(p.query.publicKey,32)&&hex(p.query.nonce,16)&&hex(p.query.amount,32)&&hex(p.query.opening,32),'Malformed encrypted query fields');
  check(n&&Array.isArray(n.proofs)&&n.proofs.length===3&&n.proofs.map(x=>x.name).join(',')==='equality,grouped,range'&&new Set(n.proofs.map(x=>x.context_address)).size===3&&Array.isArray(p.proofData)&&p.proofData.length===3&&p.proofData.every(x=>hex(x)),'Require three distinct ordered proof contexts');
  check(hex(n.native_instruction?.data)&&hex(n.expected_commitment,32)&&hex(n.expected_new_source_ciphertext,64)&&hex(n.source_data_sha256,32)&&hash(hx(p.sourceData)).toString('hex')===n.source_data_sha256,'Malformed native binding');
  for(const key of [p.genesis,p.owner,p.admin,p.effect,p.permit,p.action,p.job,p.computation,n.source,n.destination,n.mint,...n.proofs.map(x=>x.context_address),...Object.values(d.programs)])check(pk(key).toBase58()===key,'Noncanonical account address');
  check(new Set([p.job,p.computation,p.permit,p.action,p.effect,d.quota]).size===6&&new Set([n.source,n.destination,n.mint,...n.proofs.map(x=>x.context_address)]).size===6,'Operation account aliases');
  check(d.schema===1&&d.profile==='local-custom-policy-v1'&&d.cipher==='cspl-rescue-scalar253-v1'&&['releaseHashHex','schemaHashHex','domainHashHex','mxePublicKeyHex'].every(k=>hex(d[k],32)),'Unsupported deployment identity');
  check(Array.isArray(d.stateFields)&&d.stateFields.length>=1&&d.stateFields.length<=4&&d.stateFields.every(f=>f.type==='u64'&&/^[a-z][a-z0-9_]{0,47}$/.test(f.name)&&Object.keys(f).sort().join(',')==='name,type')&&new Set(d.stateFields.map(f=>f.name)).size===d.stateFields.length,'Invalid private state schema');
  check(d.schemaHashHex===digest({profile:d.profile,cipher:d.cipher,stateFields:d.stateFields,slots:4})&&d.domainHashHex===hash(Buffer.from('cyperlink-policy-domain-v1'),pk(d.programs.auth).toBuffer(),pk(d.programs.policy).toBuffer(),pk(d.quota).toBuffer(),hx(d.releaseHashHex),hx(d.schemaHashHex)).toString('hex'),'Deployment schema/domain mismatch');
  check(d.programs.kernel===d.programs.guard&&new Set(['auth','policy','guard','merchant','license','proofBuffer'].map(k=>d.programs[k])).size===6,'Deployment program alias mismatch');
  check(p.genesis===d.genesisHash && p.owner===n.owner,'Operation ledger/owner mismatch');
  check(c.pda(pk(d.programs.license),Buffer.from('license'),pk(p.owner).toBuffer(),hx(p.product)).toBase58()===p.effect,'Noncanonical license PDA');
  const q=hx(p.quotaSnapshot),v=quota(q,d,pk),t=hx(p.queuedTemplate);
  check(v.admin===p.admin && t.length===712 && t[0]===0 && t[1]===0 && zero(t.subarray(2,8)) && zero(t.subarray(48,80)) && zero(t.subarray(480,512)) && zero(t.subarray(520,616)),'Malformed immutable template');
  const rebuilt=template(n,hx(p.sourceData),p.proofData.map(hx),d,p.owner,p.product,p.expiry,p.effect,pk);
  check(rebuilt.subarray(80).equals(t.subarray(80,464)) && t.subarray(8,16).equals(q.subarray(0,8)) && t.subarray(16,48).equals(q.subarray(8,40)) && t.subarray(464,480).equals(le(v.counter+1n,16)) && t.subarray(512,520).equals(le(p.query.expiry)) && t.subarray(616).equals(q.subarray(257)),'Native/action/predecessor binding mismatch');
  const input=hash(hx(p.query.publicKey),hx(p.query.nonce),hx(p.query.amount),hx(p.query.opening),q.subarray(40,56),v.ciphertexts,t.subarray(464,480),hx(n.expected_commitment),q.subarray(257));
  check(input.toString('hex')===p.inputsHash,'Encrypted input binding mismatch');
}
export async function assertPreparedAction(c,p,minContextSlot=p.contextSlot) {
  const r=await c.rpc.getAccountInfoAndContext(c.pk(p.action),{commitment:'confirmed',minContextSlot});
  const b=checkedAccount(r.value,p.deployment.programs.auth,1200),t=hx(p.queuedTemplate),length=b.readUInt32LE(504);
  check(r.context.slot>=minContextSlot && b.subarray(0,8).equals(hash(Buffer.from('account:PreparedAction')).subarray(0,8)) && b.subarray(8,40).equals(c.pk(p.owner).toBuffer()) && zero(b.subarray(40,120)) && b.subarray(120,504).equals(t.subarray(80,464)) && length<=256 && b.subarray(508,508+length).equals(hx(p.native.native_instruction.data)) && zero(b.subarray(508+length)),'PreparedAction differs from signed intent');
}
export function checkedAccount(a,owner,length) { check(a && !a.executable && a.owner.toBase58()===owner && a.data.length===length,'Missing account or wrong owner/layout'); return a.data; }
export function reconcile(c,p,r) {
  const d=p.deployment,[ja,pa,qa,ea]=r.value,t=hx(p.queuedTemplate),pb=checkedAccount(pa,d.programs.policy,712),qb=checkedAccount(qa,d.programs.policy,353),eb=checkedAccount(ea,d.programs.license,81),q=quota(qb,d,c.pk);
  check(r.context.slot>=p.contextSlot && q.admin===p.admin && pb[0]<=3 && pb[1]<=1 && zero(pb.subarray(2,8)),'Invalid observation state');
  const issued=!zero(eb),previous=q.version===t.readBigUInt64LE(8) && qb.subarray(8,40).equals(t.subarray(16,48));
  if(issued) check(eb.subarray(0,8).toString()==='LICENSE1' && eb[80]===1 && eb.subarray(8,40).equals(c.pk(p.owner).toBuffer()) && eb.subarray(40,72).equals(hx(p.product)) && eb.readBigUInt64LE(72)===BigInt(p.expiry),'License exact effect mismatch');
  const result=status=>({status,paymentCommitted:status==='committed',slot:r.context.slot,commitment:'confirmed',quotaVersion:q.version.toString(),licenseActive:issued && BigInt(r.context.slot)<BigInt(p.expiry)});
  if(!ja) {check(zero(pb)&&!issued,'Missing Job with effects');return result('unobserved');}
  const j=checkedAccount(ja,d.programs.auth,1200);
  check(j.subarray(0,8).equals(hash(Buffer.from('account:Job')).subarray(0,8))&&j[8]===1&&j[9]<=4&&zero(j.subarray(874))&&j.subarray(10,42).equals(c.pk(p.owner).toBuffer())&&j.subarray(42,74).equals(c.pk(p.computation).toBuffer())&&j.subarray(74,106).equals(c.pk(p.permit).toBuffer())&&j.subarray(106,122).equals(t.subarray(464,480))&&j.subarray(122,130).equals(t.subarray(512,520))&&j.subarray(130,842).equals(t)&&j.subarray(842,874).equals(hx(p.inputsHash)),'Immutable Job binding mismatch');
  if(pb[1]===1) {for(const [a,b] of [[2,48],[80,480],[512,520],[616,712]])check(pb.subarray(a,b).equals(t.subarray(a,b)),'Permit binding mismatch');check(pb.subarray(48,80).equals(stateHash(pb.subarray(464,480),Buffer.concat([pb.subarray(480,512),pb.subarray(520,616)]),pb.subarray(616))),'Successor state hash mismatch');}
  check(pb[0]!==1 && q.version>=t.readBigUInt64LE(8),'Armed permit or regressed quota');
  if(q.version===t.readBigUInt64LE(8))check(previous,'Unversioned quota mutation');
  if(issued||pb[0]===2) {check(issued&&pb[0]===2&&pb[1]===1&&j[9]===1&&q.version>t.readBigUInt64LE(8),'Partial settlement evidence');if(q.version===t.readBigUInt64LE(8)+1n)check(qb.subarray(8,40).equals(pb.subarray(48,80))&&qb.subarray(40,56).equals(pb.subarray(464,480))&&q.ciphertexts.equals(Buffer.concat([pb.subarray(480,512),pb.subarray(520,616)])),'Wrong committed successor');return result('committed');}
  if(j[9]===2||j[9]===4){check(zero(pb),'Denied/invalidated job has permit');return result(j[9]===2?'denied':'invalidated');}
  if(j[9]===3){check(pb[0]===3&&(pb[1]===1||zero(pb.subarray(1))),'Invalid cancelled state');return result('cancelled');}
  check(j[9]===0?zero(pb):pb[0]===0&&pb[1]===1,'Callback/permit mismatch');
  if(BigInt(r.context.slot)>BigInt(p.query.expiry)||BigInt(r.context.slot)>=BigInt(p.expiry))return result('expired');
  if(!previous)return result('stale'); return result(j[9]===0?'queued':'authorized');
}
