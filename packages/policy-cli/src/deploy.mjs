import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir, realpath, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { ROOT, PROFILE, CIPHER, sha, canonical, json, freshJson, command, readRelease, assertHostCompiler } from './package.mjs';
import { LocalSession, createPrivateRun, loadWeb3, loadSigner, saveSigner, loopbackEndpoint, TOKEN_PROGRAM } from '../../local-client/src/runtime.mjs';
import { SignedInstructionSender, sleep } from '../../local-client/src/transaction-sender.mjs';
import { verifyUploadedCircuit } from './circuit-evidence.mjs';
import { provision } from './provision.mjs';
import { validateDeployment, policyDomainHash } from '../../policy-client/src/deployment.mjs';
import { decodeQuota } from '../../policy-client/src/index.mjs';

async function pinnedTools(){
 await assertHostCompiler();
 const installation=await json(join(ROOT,'.local/toolchain/native/installation.json')),pins=await json(join(ROOT,'config/local-toolchain.json'));
 for(const name of['sbf','anchor','validator']){const record=installation.executables[name];assert.equal(sha(await readFile(record.path)),record.sha256);assert.equal(record.sha256,pins.executables[name].sha256);}
 const solana=join(dirname(installation.executables.validator.path),'solana');
 // The exact release archive installation supplies this sibling; verify version in addition to archive provenance.
 assert((await command(solana,['--version'])).startsWith('solana-cli 4.3.0 '));
 return {...Object.fromEntries(Object.entries(installation.executables).map(([k,v])=>[k,v.path])),solana};
}
async function loadedProgram(program,elf,endpoint,out){await command('python3',[join(ROOT,'scripts/verify_loaded_program.py'),'--program-id',program,'--elf',elf,'--rpc',endpoint,'--output',out]);const report=await json(out);assert(report.matched);return report;}
async function waitJob(program,key,expected){for(let i=0;i<600;i++){const job=await program.account.job.fetch(key);if(job.status!==0){assert.equal(job.status,expected);return job;}await sleep(250);}throw Error('Actual private callback timeout; preserve the partial deployment');}
async function recordFor(connection,signature,label,category){for(let i=0;i<80;i++){const tx=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(tx){assert.equal(tx.meta.err,null);return{signature,label,category,slot:tx.slot,landedCU:tx.meta.computeUnitsConsumed??0,feeLamports:tx.meta.fee,transaction:tx};}await sleep(250);}throw Error('Missing deployment receipt');}

/** Only fresh loopback deployments. A failed phase is retained; never interpreted as success or silently resumed. */
export async function deployPackage(directory,options){
 assert.equal(options.local,true,'Deployment requires explicit --local');assert(options['--environment']&&options['--initial-state']&&options['--out'],'Require --environment --initial-state --out');
 const preparation=await json(resolve(options['--environment'])),endpoint=loopbackEndpoint(preparation.rpc);assert.equal(preparation.profile,'provisioned161','Use the pinned fresh localnet environment');
 const {release,releaseDirectory}=await readRelease(directory);const tools=await pinnedTools();
 const output=await createPrivateRun(options['--out']),moduleRoot=resolve(options['--module-root']??join(ROOT,'.local/toolchain/js'));
 const initialPath=resolve(options['--initial-state']),privateRoot=await realpath(join(ROOT,'.local'));
 const initialStat=await lstat(initialPath);assert(initialStat.isFile()&&!initialStat.isSymbolicLink(),'Private initialization must be a regular file');assert.equal(initialStat.mode&0o077,0,'Private initialization must have owner-only permissions');assert.equal(initialStat.uid,process.getuid(),'Private initialization must belong to the current user');assert((await realpath(initialPath)).startsWith(privateRoot+'/'),'Keep private initialization under ignored .local');
 const initial=await json(initialPath);assert.deepEqual(Object.keys(initial).sort(),release.package.stateFields.map(f=>f.name).sort(),'Private initial-state fields differ from declared schema');
 const values=release.package.stateFields.map(({name})=>{const v=initial[name];assert(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v),'Initial private integers must be canonical decimal strings');const n=BigInt(v);assert(n<=0xffffffffffffffffn,'Private initial field out of u64 range');return n;});while(values.length<4)values.push(0n);
 const payerKeyfile=join(preparation.app,'local-test-wallet.json'),web3=await loadWeb3(moduleRoot),payer=await loadSigner(payerKeyfile,web3),require=createRequire(join(moduleRoot,'package.json'));
 for(const[name,version]of Object.entries({'@anchor-lang/core':'1.2.0','@arcium-hq/client':'0.15.0','bn.js':'5.2.5'}))assert.equal((await json(join(moduleRoot,'node_modules',name,'package.json'))).version,version,'Unsupported runtime dependency '+name);
 const anchor=require('@anchor-lang/core'),ar=require('@arcium-hq/client'),BN=require('bn.js'),{PublicKey,Keypair,SystemProgram,TransactionInstruction}=web3;
 const txDirectory=await createPrivateRun(join(output,'transactions')),session=new LocalSession({web3,endpoint,payer,directory:txDirectory});await session.assertLocalVersions();
 const provider=new anchor.AnchorProvider(session.connection,new anchor.Wallet(payer),{commitment:'confirmed',preflightCommitment:'confirmed'}),connection=session.connection;
 const disabledV0='B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g';
 const restriction=await connection.getAccountInfo(new PublicKey(disabledV0),'confirmed');assert(!restriction||restriction.data[0]===0,'This validator disables new pinned SBPF v0 deployments; prepare a fresh ledger with --allow-pinned-sbf-v0-deployment');
 const genesisHash=await connection.getGenesisHash(),programs={},signers={};
 const result={schema:1,passed:false,phase:'building-programs',evidenceLevel:'real-local-deployment-in-progress',genesisHash,localFeatureDeviation:{disabledDeploymentRestriction:disabledV0,sbfArch:'v0'},releaseHashHex:release.releaseHashHex,transactions:[],callbacks:[],loadedPrograms:[],limitations:['Same local cluster/operator trust; distinct MXE encryption keys','Private initialization values omitted; no production/public-network claim','Program upgrade authority remains trusted','Deployment recovery from arbitrary partial phase is unsupported; preserve artifacts']};
 const save=()=>writeFile(join(output,'results.json'),JSON.stringify(result,null,2),{mode:0o600});await save();
 const transport=new SignedInstructionSender(session,async receipt=>{result.transactions.push(receipt);await save();});
 try{
  for(const name of['auth','policy','guard','merchant','license']){const key=Keypair.generate();signers[name]=key;programs[name]=key.publicKey.toBase58();await saveSigner(join(output,`${name}-program-keypair.json`),key);}
  programs.kernel=programs.guard;programs.proofBuffer=new PublicKey(Buffer.alloc(32,89)).toBase58();
  const Q=PublicKey.findProgramAddressSync([Buffer.from('quota')],new PublicKey(programs.policy))[0];
  const partial={schema:1,profile:PROFILE,releaseHashHex:release.releaseHashHex,schemaHashHex:release.schemaHashHex,programs,quota:Q.toBase58(),genesisHash,cipher:CIPHER,stateFields:release.package.stateFields};
  partial.domainHashHex=policyDomainHash(partial);
  const config=Object.fromEntries(['auth','policy','guard','merchant','license'].map(name=>[name,Array.from(new PublicKey(programs[name]).toBuffer())]));
  Object.assign(config,{quota:Array.from(Q.toBuffer()),release:Array.from(Buffer.from(partial.releaseHashHex,'hex')),schema:Array.from(Buffer.from(partial.schemaHashHex,'hex')),domain:Array.from(Buffer.from(partial.domainHashHex,'hex'))});
  const configPath=join(output,'deployment-bytes.json');await freshJson(configPath,config);
  const workspace=join(output,'programs');await command('python3',[join(ROOT,'programs/custom-policy/stage.py'),'--config',configPath,'--out',workspace,'--circuits',join(releaseDirectory,'circuits')]);
  const deploy=join(workspace,'target/deploy');await mkdir(deploy,{recursive:true});
  const env={PATH:join(process.env.HOME,'.cargo/bin')+':'+process.env.PATH,CARGO_TARGET_DIR:join(workspace,'target/build-cache')};
  for(const [name,path]of[['native','native/Cargo.toml'],['auth','auth/programs/cyperlink_auth/Cargo.toml']])await command(tools.sbf,['--manifest-path',join(workspace,path),'--tools-version','v1.57','--arch','v0','--sbf-out-dir',deploy,'--offline','--','--locked'],{cwd:join(workspace,name),env,log:join(output,`build-${name}.log`)});
  await mkdir(join(workspace,'auth/target/idl'),{recursive:true});await mkdir(join(workspace,'auth/target/types'),{recursive:true});
  await command(tools.anchor,['idl','build','-p','cyperlink_auth','-o','target/idl/cyperlink_auth.json','-t','target/types/cyperlink_auth.ts'],{cwd:join(workspace,'auth'),env,log:join(output,'build-idl.log')});
  assert.equal((await readRelease(directory)).release.releaseHashHex,release.releaseHashHex,'Release changed during program build');
  result.phase='deploying-programs';await save();
  const filenames={auth:'cyperlink_auth.so',policy:'ct_policy_spike.so',guard:'ct_guard_spike.so',merchant:'cyperlink_merchant.so',license:'cyperlink_license.so'};
  for(const [name,file]of Object.entries(filenames)){
   const elf=join(deploy,file);await command(tools.solana,['program','deploy',elf,'--url',endpoint,'--keypair',payerKeyfile,'--program-id',join(output,`${name}-program-keypair.json`),'--use-rpc','--commitment','confirmed','--max-sign-attempts','1','--output','json'],{log:join(output,`deploy-${name}.log`)});
   result.loadedPrograms.push(await loadedProgram(programs[name],elf,endpoint,join(output,`loaded-${name}.json`)));await save();
  }
  for(const d of preparation.deployments.filter(d=>[TOKEN_PROGRAM,programs.proofBuffer,'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ','ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq','L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'].includes(d.address)))result.loadedPrograms.push(await loadedProgram(d.address,d.elf,endpoint,join(output,`loaded-upstream-${result.loadedPrograms.length}.json`)));
  assert.equal(result.loadedPrograms.length,10);
  const idl=join(workspace,'auth/target/idl/cyperlink_auth.json'),program=new anchor.Program(await json(idl),provider),auth=new PublicKey(programs.auth),H=new PublicKey(programs.policy);
  const mxe=ar.getMXEAccAddress(auth),arcium=ar.getArciumProgram(provider);
  result.phase='initializing-mxe';await save();
  // Use exact upstream account builders but the durable sender; no node/key material is supplied by the caller.
  const mxePart1=await arcium.methods.initMxePart1(Array(100).fill(0)).accountsPartial({signer:payer.publicKey,mxeProgram:auth}).instruction();
  await transport.send('initialize-mxe-part1',[mxePart1],[],{category:'mxe-initialization'});
  const lutSlot=new BN(await connection.getSlot('finalized')),keygen=new BN(randomBytes(8),'le'),recovery=new BN(randomBytes(8),'le');
  const mxePart2=await arcium.methods.initMxePart2(0,keygen,recovery,lutSlot).accountsPartial({signer:payer.publicKey,mxeProgram:auth,poolAccount:ar.getFeePoolAccAddress(),mxeAuthority:payer.publicKey,addressLookupTable:ar.getLookupTableAddress(auth,lutSlot)}).instruction();
  const stakeIx=await ar.getArciumStakingProgram(provider).methods.initMxeRecoveryStakeState(auth).accountsPartial({payer:payer.publicKey,mxeRecoveryStakeState:ar.getMxeRecoveryStakeStateAccAddress(auth),instructionsSysvar:web3.SYSVAR_INSTRUCTIONS_PUBKEY,systemProgram:SystemProgram.programId}).instruction();
  await transport.send('initialize-mxe-part2',[mxePart2,stakeIx],[],{category:'mxe-initialization'});
  let mxeKey;for(let i=0;i<600&&!mxeKey;i++){mxeKey=await ar.getMXEPublicKey(provider,auth);if(!mxeKey)await sleep(250);}assert(mxeKey,'MXE key generation unavailable');
  const descriptor=validateDeployment({...partial,mxePublicKeyHex:Buffer.from(mxeKey).toString('hex')});
  await freshJson(join(output,'deployment.json'),descriptor);
  const admission=PublicKey.findProgramAddressSync([Buffer.from('admission')],auth)[0],programData=PublicKey.findProgramAddressSync([auth.toBuffer()],new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
  await transport.send('provision-policy-state',[await program.methods.provisionQuota().accounts({payer:payer.publicKey,programData,quota:Q,policyProgram:H,admission,systemProgram:SystemProgram.programId}).instruction()],[],{category:'policy-provisioning'});
  result.phase='registering-circuits';await save();
  const definition=name=>ar.getCompDefAccAddress(auth,Buffer.from(ar.getCompDefAccOffset(name)).readUInt32LE());
  for(const [name,method]of[['runtime_policy_init','initRuntimePolicyInitCompDef'],['runtime_policy_evaluate','initRuntimePolicyEvaluateCompDef']]){
   const mxeAccount=await arcium.account.mxeAccount.fetch(mxe),bytes=await readFile(join(releaseDirectory,'circuits',name+'.arcis'));
   assert.equal(sha(bytes),release.artifacts[name+'.arcis'].sha256);
   const ix=await program.methods[method]().accounts({payer:payer.publicKey,quota:Q,mxeAccount:mxe,compDefAccount:definition(name),addressLookupTable:ar.getLookupTableAddress(auth,mxeAccount.lutOffsetSlot)}).instruction();
   await transport.send(name+'-definition',[ix],[],{category:'arcium-definition'});
   await ar.uploadCircuit(provider,name,auth,bytes,true,500,{skipPreflight:false,commitment:'confirmed'});
   // Preserve all definition/upload receipts; older pagination is explicit for circuits larger than1000 writes.
   let before;for(;;){const batch=await connection.getSignaturesForAddress(definition(name),{limit:1000,...(before?{before}:{})},'confirmed');for(const item of batch)if(!result.transactions.some(tx=>tx.signature===item.signature))result.transactions.push(await recordFor(connection,item.signature,name+'-upload','arcium-circuit-upload'));if(batch.length<1000)break;before=batch.at(-1).signature;}
   const verified=await verifyUploadedCircuit({connection,ar,arcium,definition:definition(name),payer:payer.publicKey,bytes,interfaceBytes:await readFile(join(releaseDirectory,'circuits',name+'.idarc'))});
   await freshJson(join(output,name+'-uploaded-evidence.json'),verified);
   const defAccount=await arcium.account.computationDefinitionAccount.fetch(definition(name));
   await freshJson(join(output,name+'-definition.json'),{definition:definition(name).toBase58(),account:defAccount,circuitSha256:sha(bytes),interfaceSha256:release.artifacts[name+'.idarc'].sha256});await save();
  }
  result.phase='initializing-private-state';await save();
  const secret=ar.x25519.utils.randomSecretKey(),pk=Array.from(ar.x25519.getPublicKey(secret)),nonce=randomBytes(16),cipher=new ar.CSplRescueCipher(ar.x25519.getSharedSecret(secret,mxeKey)),encrypted=cipher.encrypt(values,nonce);secret.fill(0);
  const offset=new BN(randomBytes(8),'le'),job=PublicKey.findProgramAddressSync([Buffer.from('job'),offset.toArrayLike(Buffer,'le',8)],auth)[0],computation=ar.getComputationAccAddress(0,offset);
  await transport.send('initialize-private-state',[await program.methods.runtimePolicyInit(offset,pk,new BN(ar.deserializeLE(nonce).toString()),encrypted.map(ct=>Array.from(ct))).accountsPartial({payer:payer.publicKey,job,quota:Q,policyProgram:H,admission,computationAccount:computation,clusterAccount:ar.getClusterAccAddress(0),mxeAccount:mxe,mempoolAccount:ar.getMempoolAccAddress(0),executingPool:ar.getExecutingPoolAccAddress(0),compDefAccount:definition('runtime_policy_init')}).instruction()],[],{category:'arcium-queue'});
  await waitJob(program,job,1);
  for(const entry of await connection.getSignaturesForAddress(job,{limit:30},'confirmed')){if(entry.err)continue;const receipt=await recordFor(connection,entry.signature,'private-state-initializer-callback','arcium-signed-callback');if(receipt.transaction.meta.logMessages?.some(line=>line.includes('Instruction: RuntimePolicyInitCallback'))){result.callbacks.push(receipt);break;}}
  assert.equal(result.callbacks.length,1,'Require actual successful initialization callback');
  const state=await connection.getAccountInfo(Q,'confirmed');const decoded=decodeQuota(state.data);assert.equal(state.owner.toBase58(),programs.policy);assert.equal(decoded.version,0n);assert.equal(state.data.subarray(257,289).toString('hex'),descriptor.releaseHashHex);assert.equal(state.data.subarray(289,321).toString('hex'),descriptor.schemaHashHex);assert.equal(state.data.subarray(321,353).toString('hex'),descriptor.domainHashHex);
  result.phase='provisioning-native-assets';await save();
  const common={endpoint,moduleRoot,proofCli:join(ROOT,'crates/client-proofs/target/debug/cyperlink-client-proofs'),payerKeyfile,hookProgram:programs.policy};
  const assetA=await provision({...common,directory:join(output,'asset-a')});await provision({...common,directory:join(output,'asset-b'),existingMint:assetA.accounts.mint.address});
  const mint=new PublicKey(assetA.accounts.mint.address),metadata=PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'),mint.toBuffer()],H)[0];
  await transport.send('initialize-custom-hook',[new TransactionInstruction({programId:H,data:Buffer.from([7]),keys:[{pubkey:mint,isSigner:false,isWritable:false},{pubkey:metadata,isSigner:false,isWritable:true},{pubkey:payer.publicKey,isSigner:true,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})],[],{category:'policy-provisioning'});
  const instance={schema:1,passed:true,policyName:release.package.name,descriptor,endpoint,moduleRoot,payerKeyfile,idl,proofCli:common.proofCli,assetDirectories:{merchant:join(output,'asset-a'),license:join(output,'asset-b')},releaseDirectory,results:join(output,'results.json'),preparation:resolve(options['--environment'])};
  await freshJson(join(output,'instance.json'),instance);result.phase='ready';result.passed=true;result.descriptor=descriptor;await save();return{passed:true,instance:join(output,'instance.json'),releaseHashHex:release.releaseHashHex,programs,genesisHash};
 }catch(error){result.failedPhase=result.phase;result.phase='failed-retained';result.error=String(error.message).split('\n')[0].slice(0,500);await save();throw error;}
}
