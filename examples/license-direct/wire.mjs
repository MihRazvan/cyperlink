// Independently authored direct web3 delivery. No CyperLink sender/worker imports.
import { open, mkdir, realpath, stat, readdir, rmdir, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { verify, randomUUID } from 'node:crypto';
import { check, digest, hash, encodeIx } from './abi.mjs';
export const wait = ms => new Promise(r=>setTimeout(r,ms));
export async function save(path,value) {
  await privateDir(dirname(path));
  const temporary=path+'.tmp-'+randomUUID(),f=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {await f.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));await f.sync();}finally{await f.close();}
  // link is atomic and refuses replacement; a crash exposes either no role file
  // or the complete fsynced wire. Orphan temporary files never become authority.
  await link(temporary,path);const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}
  await unlink(temporary);const clean=await open(dirname(path),'r');try{await clean.sync();}finally{await clean.close();}
}
export async function read(path) {
  check(await realpath(path)===resolve(path),'Symlink file forbidden');
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();check(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.size<2000000,'Require private bounded local file');return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}
}
export async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function privateDir(path){
  path=resolve(path);const local=resolve('.local');check(path.startsWith(local+'/'),'Private state must stay below repository .local');
  const parts=path.slice(local.length+1).split('/');let parent=local;
  for(const part of parts){check(await realpath(parent)===parent,'Symlink directory forbidden');const ps=await stat(parent);check(ps.isDirectory()&&ps.uid===process.getuid(),'Directory owner mismatch');const next=resolve(parent,part);try{await mkdir(next,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}check(await realpath(next)===next,'Symlink directory forbidden');const ns=await stat(next);check(ns.isDirectory()&&ns.uid===process.getuid()&&(ns.mode&0o077)===0,'Require private owned directory');parent=next;}const handle=await open(dirname(path),'r');try{await handle.sync();}finally{await handle.close();}
}

export function validateWire(c,record,expected,planHash) {
  check(record.schema==='direct-wire-v1'&&record.genesis===c.instance.descriptor.genesisHash&&record.planHash===planHash,'Wire ledger/operation mismatch');
  check(typeof record.wire==='string'&&Number.isSafeInteger(record.minSlot)&&record.minSlot>=0&&Number.isSafeInteger(record.blockhash?.lastValidBlockHeight)&&record.blockhash.lastValidBlockHeight>0&&Array.isArray(record.tables),'Malformed wire metadata');
  const wire=Buffer.from(record.wire,'base64');check(wire.length<=1232&&wire.toString('base64')===record.wire,'Noncanonical or oversized wire');const tx=c.w.VersionedTransaction.deserialize(wire),tables=record.tables.map(t=>new c.w.AddressLookupTableAccount({key:c.pk(t.key),state:{deactivationSlot:18446744073709551615n,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,addresses:t.addresses.map(c.pk)}}));
  check(tx.version===0&&tx.signatures.length===tx.message.header.numRequiredSignatures&&tx.signatures.length>0,'Unsupported transaction/signature count');
  check(Buffer.from(tx.serialize()).equals(wire)&&tx.message.recentBlockhash===record.blockhash.blockhash,'Noncanonical wire or blockhash mismatch');
  check(c.bs58.encode(tx.signatures[0])===record.signature,'Signature identity mismatch');
  for(let i=0;i<tx.message.header.numRequiredSignatures;i++)check(verify(null,tx.message.serialize(),{key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),tx.message.staticAccountKeys[i].toBuffer()]),format:'der',type:'spki'},tx.signatures[i]),'Invalid retained Ed25519 signature');
  const rebuilt=new c.w.TransactionMessage({payerKey:c.pk(record.payer),recentBlockhash:record.blockhash.blockhash,instructions:expected}).compileToV0Message(tables);
  check(Buffer.from(rebuilt.serialize()).equals(Buffer.from(tx.message.serialize())),'Signed instructions differ from exact authorized role');
  return {wire,tx,tables};
}
export async function tableFor(c,ixs,directory) {
  const {w,rpc,payer}=c;
  const [create,key]=w.AddressLookupTableProgram.createLookupTable({authority:payer.publicKey,payer:payer.publicKey,recentSlot:await rpc.getSlot('finalized')});
  await sendSetup(c,directory,'alt-create',[create]);
  const addresses=[...new Map(ixs.flatMap(ix=>[ix.programId,...ix.keys.map(k=>k.pubkey)]).map(k=>[k.toBase58(),k])).values()];
  for(let i=0;i<addresses.length;i+=20)await sendSetup(c,directory,`alt-extend-${i}`,[w.AddressLookupTableProgram.extendLookupTable({lookupTable:key,authority:payer.publicKey,payer:payer.publicKey,addresses:addresses.slice(i,i+20)})]);
  for(let i=0;i<240;i++){const r=await rpc.getAddressLookupTable(key,{commitment:'finalized'});if(r.value&&r.context.slot>r.value.state.lastExtendedSlot&&addresses.every(a=>r.value.state.addresses.some(b=>a.equals(b))))return r.value;await wait(250);}
  throw Error('ALT did not become rooted; no application approval was signed');
}
export const budgeted = (c,ixs) => [c.w.ComputeBudgetProgram.setComputeUnitLimit({units:1300000}),...ixs];
export async function stage(c,path,ixs,signers,{role,planHash=null,minSlot=0,alt=true,expectedError}={}) {
  check(!await exists(path),'Wire already exists: recover retained bytes');
  check(await c.rpc.getGenesisHash()===c.instance.descriptor.genesisHash,'Wrong ledger');
  const instructions=budgeted(c,ixs),{w,rpc,payer}=c;
  let latest=await rpc.getLatestBlockhash('confirmed'),tables=[];
  const assemble=()=>{const t=new w.VersionedTransaction(new w.TransactionMessage({payerKey:payer.publicKey,recentBlockhash:latest.blockhash,instructions}).compileToV0Message(tables));t.sign([...new Map([payer,...signers].map(s=>[s.publicKey.toBase58(),s])).values()]);return t;};
  let tx=assemble(),size;try{size=tx.serialize().length;}catch{size=Infinity;}
  if(size>1232&&alt){tables=[await tableFor(c,ixs,dirname(path))];latest=await rpc.getLatestBlockhash('confirmed');tx=assemble();}
  const wire=Buffer.from(tx.serialize());check(wire.length<=1232,'Wire exceeds packet limit');
  const record={schema:'direct-wire-v1',storagePath:resolve(path),role,planHash,...(expectedError===undefined?{}:{expectedError}),genesis:c.instance.descriptor.genesisHash,payer:payer.publicKey.toBase58(),minSlot,signature:c.bs58.encode(tx.signatures[0]),blockhash:latest,wire:wire.toString('base64'),tables:tables.map(t=>({key:t.key.toBase58(),addresses:t.state.addresses.map(k=>k.toBase58())})),created:new Date().toISOString()};
  validateWire(c,record,instructions,planHash);await save(path,record); // exact wire is durable before simulation/send
  const sim=await rpc.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed',minContextSlot:minSlot});sim.directBinding={signature:record.signature,wireSha256:hash(wire).toString('hex')};await save(path+'.simulation.json',sim);
  check(expectedError===undefined?!sim.value.err:sim.value.err?.InstructionError?.[1]?.Custom===expectedError,`Simulation rejected unexpectedly; retained wire cannot be replaced: ${JSON.stringify(sim.value)}`);return record;
}
export async function recover(c,record,expected,planHash,{submit=false,poll=1}={}) {
  check(await c.rpc.getGenesisHash()===record.genesis,'Recovery ledger changed');
  const {wire,tx,tables}=validateWire(c,record,expected,planHash);
  for(const table of tables){const observed=await c.rpc.getAddressLookupTable(table.key,{commitment:'confirmed',minContextSlot:record.minSlot}),live=observed.value;check(observed.context.slot>=record.minSlot&&live&&table.state.addresses.every((a,i)=>live.state.addresses[i]?.equals(a)),'Retained ALT resolution changed');}
  let sendError,lastStatus,receiptError,height,validBlockhash,statusEvidenceValid=false;
  for(let i=0;i<poll;i++){
    let receipt;
    try{receipt=await c.rpc.getTransaction(record.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});}catch(e){receiptError=e.message;}
    if(receipt){check(receipt.meta&&'err' in receipt.meta,'Receipt metadata missing');const loaded={writable:[],readonly:[]};for(const lookup of tx.message.addressTableLookups){const table=tables.find(t=>t.key.equals(lookup.accountKey));check(table,'Missing retained lookup table');for(const kind of ['writable','readonly'])for(const index of lookup[kind+'Indexes'])loaded[kind].push(table.state.addresses[index].toBase58());}for(const kind of ['writable','readonly'])check(JSON.stringify((receipt.meta.loadedAddresses?.[kind]??[]).map(k=>k.toBase58()))===JSON.stringify(loaded[kind]),'Receipt loaded addresses differ');check(receipt.slot>=record.minSlot&&Buffer.from(receipt.transaction.message.serialize()).equals(Buffer.from(tx.message.serialize()))&&receipt.transaction.signatures.length===tx.signatures.length&&receipt.transaction.signatures.every((s,i)=>s===c.bs58.encode(tx.signatures[i])),'RPC receipt differs from retained signed transaction');return {status:receipt.meta?.err?'rejected':'confirmed',signature:record.signature,slot:receipt.slot,receipt};}
    try{const statuses=await c.rpc.getSignatureStatuses([record.signature],{searchTransactionHistory:true});check(statuses.context.slot>=record.minSlot,'Signature context regressed');lastStatus=statuses.value[0];statusEvidenceValid=true;}catch(e){statusEvidenceValid=false;receiptError=e.message;}
    try{height=await c.rpc.getBlockHeight('confirmed');}catch(e){receiptError=e.message;}
    if(submit&&i===0&&height!==undefined&&height<=record.blockhash.lastValidBlockHeight&&!lastStatus&&statusEvidenceValid){
      try{validBlockhash=await c.rpc.isBlockhashValid(record.blockhash.blockhash,{commitment:'confirmed',minContextSlot:record.minSlot});check(validBlockhash.context.slot>=record.minSlot&&validBlockhash.value,'Blockhash validity unavailable or expired');
        check(record.storagePath&&digest(await read(record.storagePath))===digest(record),'Durable role wire differs');
        const simulationPath=record.storagePath+'.simulation.json';if(!await exists(simulationPath)){const sim=await c.rpc.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed',minContextSlot:record.minSlot});sim.directBinding={signature:record.signature,wireSha256:hash(wire).toString('hex')};try{await save(simulationPath,sim);}catch(e){if(e.code!=='EEXIST')throw e;}}
        const sim=await read(simulationPath);check(Number.isSafeInteger(sim.context?.slot)&&sim.context.slot>=record.minSlot&&sim.directBinding?.signature===record.signature&&sim.directBinding?.wireSha256===hash(wire).toString('hex')&&(record.expectedError===undefined?sim.value?.err===null:sim.value?.err?.InstructionError?.[1]?.Custom===record.expectedError),'Retained simulation does not authorize broadcast');
        const attempts=record.storagePath+'.attempts';await privateDir(attempts);const lock=resolve(attempts,'send.lock');await mkdir(lock,{mode:0o700});
        try{const used=(await readdir(attempts)).filter(x=>/^attempt-[0-9]+\.json$/.test(x)).length;check(used<3,'Durable broadcast attempt limit reached');await save(resolve(attempts,`attempt-${used+1}.json`),{signature:record.signature,wireSha256:hash(wire).toString('hex'),at:new Date().toISOString()});
          const s=await c.rpc.sendRawTransaction(wire,{skipPreflight:record.expectedError!==undefined,preflightCommitment:'confirmed',maxRetries:0,minContextSlot:record.minSlot});check(s===record.signature,'RPC returned another signature');
        }finally{await rmdir(lock);}
      }catch(e){sendError=e.message;}
    }
    if(i+1<poll)await wait(250);
  }
  let gate='ready',attemptsUsed=0,simulationState='missing';
  try{
    check(record.storagePath&&digest(await read(record.storagePath))===digest(record),'Durable role wire differs');
    try{attemptsUsed=(await readdir(record.storagePath+'.attempts')).filter(x=>/^attempt-[0-9]+\.json$/.test(x)).length;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(await exists(record.storagePath+'.simulation.json')){const simulation=await read(record.storagePath+'.simulation.json');simulationState=Number.isSafeInteger(simulation.context?.slot)&&simulation.context.slot>=record.minSlot&&simulation.directBinding?.signature===record.signature&&simulation.directBinding?.wireSha256===hash(wire).toString('hex')&&(record.expectedError===undefined?simulation.value?.err===null:simulation.value?.err?.InstructionError?.[1]?.Custom===record.expectedError)?'passed':'rejected';}
    if(!statusEvidenceValid)gate='recovery-evidence-unavailable';else if(attemptsUsed>=3)gate='broadcast-exhausted';else if(simulationState==='missing')gate='simulation-required';else if(simulationState==='rejected')gate='simulation-rejected';
    if(height!==undefined&&height<=record.blockhash.lastValidBlockHeight&&!lastStatus){validBlockhash=await c.rpc.isBlockhashValid(record.blockhash.blockhash,{commitment:'confirmed',minContextSlot:record.minSlot});check(validBlockhash.context.slot>=record.minSlot,'Blockhash context regressed');if(!validBlockhash.value)gate='blockhash-invalid-unresolved';}
  }catch(e){gate='recovery-evidence-unavailable';receiptError=e.message;}
  const status=lastStatus?'receipt-unavailable':height===undefined?'unknown':height>record.blockhash.lastValidBlockHeight?'expired-unresolved':gate==='ready'?'pending':gate;
  return {status,signature:record.signature,canBroadcast:statusEvidenceValid&&!lastStatus&&height!==undefined&&height<=record.blockhash.lastValidBlockHeight&&gate==='ready'&&validBlockhash?.value===true,attemptsUsed,simulationState,sendError,receiptError};
}
export async function sendSetup(c,directory,label,ixs,signers=[]) {
  const path=resolve(directory,`setup-${String(c.sequence++).padStart(3,'0')}-${label}-${randomUUID()}.json`),r=await stage(c,path,ixs,signers,{role:label,alt:false});
  const result=await recover(c,r,budgeted(c,ixs),null,{submit:true,poll:100});await save(path+'.result.json',result);check(result.status==='confirmed',`Setup ${label} unresolved/rejected; preserve directory and inspect wire`);return result;
}
