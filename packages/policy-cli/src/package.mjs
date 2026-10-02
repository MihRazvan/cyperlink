import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, rename, readdir, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const PROFILE='local-custom-policy-v1', CIPHER='cspl-rescue-scalar253-v1';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));return value;}
export const schemaDigest=fields=>sha(canonical({profile:PROFILE,cipher:CIPHER,stateFields:fields,slots:4}));
export async function json(path){return JSON.parse(await readFile(path,'utf8'));}
export async function freshJson(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export function command(bin,args,{cwd=ROOT,env={},log}={}){return new Promise((done,fail)=>{const child=spawn(bin,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';for(const stream of[child.stdout,child.stderr])stream.on('data',bytes=>{output+=bytes.toString();if(output.length>16*1024*1024)output=output.slice(-16*1024*1024);});child.on('error',fail);child.on('close',async code=>{try{if(log)await writeFile(log,output,{mode:0o600});if(code===0)done(output);else fail(Error(`${bin} failed (${code}); ${log?'inspect '+log:output.slice(-1800)}`));}catch(error){fail(error);}});});}
export function validateManifest(m){
 assert.deepEqual(Object.keys(m).sort(),['schema','name','entrypoint','profile','stateFields','inputs','effects','disclosure','initialization','queryAuthorization','compiler'].sort(),'Unsupported manifest fields');
 assert.equal(m.schema,1);assert.equal(m.profile,PROFILE);assert(/^[a-z][a-z0-9-]{0,47}$/.test(m.name));assert.equal(m.entrypoint,'policy.rs','Only policy.rs entrypoint is supported');
 assert(Array.isArray(m.stateFields)&&m.stateFields.length>=1&&m.stateFields.length<=4,'Declare1–4 state fields');const names=new Set();
 for(const field of m.stateFields){assert.deepEqual(Object.keys(field).sort(),['name','type']);assert(/^[a-z][a-z0-9_]{0,31}$/.test(field.name)&&!names.has(field.name));assert.equal(field.type,'u64');names.add(field.name);}
 assert.deepEqual(m.inputs,{nativePayment:'token-2022-no-fee-owner-v1',additional:[]});
 assert.deepEqual(m.effects,['merchant','license']);assert.deepEqual(m.disclosure,['nativeAmountCommitment','allowed','encryptedSuccessor']);
 assert.deepEqual(m.initialization,{authority:'deployment-administrator',mode:'initialize-once'});
 assert.equal(m.queryAuthorization,'explicit-owner-and-administrator');assert.deepEqual(m.compiler,{arcis:'0.15.0',nativeProofSdk:'7.0.1',cipher:CIPHER,authoringApi:'0.1.0'});return m;
}
export function defaultManifest(name,fields=['remaining']){return validateManifest({schema:1,name,entrypoint:'policy.rs',profile:PROFILE,stateFields:fields.map(name=>({name,type:'u64'})),inputs:{nativePayment:'token-2022-no-fee-owner-v1',additional:[]},effects:['merchant','license'],disclosure:['nativeAmountCommitment','allowed','encryptedSuccessor'],initialization:{authority:'deployment-administrator',mode:'initialize-once'},queryAuthorization:'explicit-owner-and-administrator',compiler:{arcis:'0.15.0',nativeProofSdk:'7.0.1',cipher:CIPHER,authoringApi:'0.1.0'}});}
export async function initPackage(directory){
 directory=resolve(directory);await mkdir(directory,{recursive:false});
 const name=directory.split('/').at(-1).toLowerCase().replace(/[^a-z0-9-]/g,'-');const manifest=defaultManifest(/^[a-z]/.test(name)?name:'policy-'+name);
 await freshJson(join(directory,'policy.json'),manifest);
 await writeFile(join(directory,'policy.rs'),`use cyperlink_policy_authoring::{Context, Payment, State, Decision};\npub const FIELDS: &[&str] = &["remaining"];\npub fn policy(ctx: &mut Context, payment: Payment, state: &State) -> Decision {\n    let amount = payment.amount();\n    let remaining = state.get("remaining");\n    let allowed = amount.gt(ctx.constant(0)).and(amount.le(remaining));\n    let next = ctx.sub(remaining, amount);\n    ctx.finish(allowed, &[next])\n}\n`,{flag:'wx'});
 await freshJson(join(directory,'tests.json'),[{name:'affordable',amount:40,state:[100],allow:true,next:[60]},{name:'overspend',amount:101,state:[100],allow:false,next:[100]},{name:'zero',amount:0,state:[100],allow:false,next:[100]}]);
 await writeFile(join(directory,'.gitignore'),'/.cyperlink/\n',{flag:'wx'});return{directory,profile:PROFILE};
}
async function filesUnder(directory){const out=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(['target','build','.git'].includes(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory())out.push(...await filesUnder(path));else if(entry.isFile()&&(/\.(rs|toml|lock|py)$/.test(entry.name)))out.push(path);}return out.sort();}
export async function platformSources(){const files=[...await filesUnder(join(ROOT,'crates/policy-authoring')),...await filesUnder(join(ROOT,'crates/custom-policy-layout')),...await filesUnder(join(ROOT,'crates/native-admission')),...await filesUnder(join(ROOT,'crates/hook-routing')),...await filesUnder(join(ROOT,'crates/pda-provisioning')),...await filesUnder(join(ROOT,'programs/custom-policy'))];return Object.fromEntries(await Promise.all(files.map(async path=>[path.slice(ROOT.length+1),sha(await readFile(path))])));}
async function stageCompiler(directory){
 directory=await realpath(resolve(directory));const manifest=validateManifest(await json(join(directory,'policy.json')));const source=await readFile(join(directory,manifest.entrypoint));
 const work=join(directory,'.cyperlink/work',randomUUID());await mkdir(join(work,'src'),{recursive:true});await writeFile(join(work,'src/policy.rs'),source);
 const dependency=JSON.stringify(join(ROOT,'crates/policy-authoring'));
 await writeFile(join(work,'Cargo.toml'),`[package]\nname="cyperlink-customer-build"\nversion="0.1.0"\nedition="2021"\n[workspace]\n[dependencies]\ncyperlink-policy-authoring={path=${dependency},version="=0.1.0"}\n`);
 const fields=manifest.stateFields.map(f=>JSON.stringify(f.name)).join(',');
 await writeFile(join(work,'src/main.rs'),`mod policy;\nfn main(){\n assert_eq!(policy::FIELDS,&[${fields}],"Source FIELDS differs from manifest schema");\n let args:Vec<String>=std::env::args().collect();\n assert_eq!(args.len(),3,"Expected build OUTDIR or test VECTORS");\n if args[1]=="build"{cyperlink_policy_authoring::build(policy::FIELDS,policy::policy,std::path::Path::new(&args[2])).unwrap();}\n else if args[1]=="test"{let result=cyperlink_policy_authoring::test_vectors(policy::FIELDS,policy::policy,std::path::Path::new(&args[2])).unwrap();println!("{}",result);}\n else{panic!("Unsupported command");}\n}\n`);
 let lock=await readFile(join(ROOT,'crates/policy-authoring/Cargo.lock'),'utf8');
 lock += '\n[[package]]\nname = "cyperlink-customer-build"\nversion = "0.1.0"\ndependencies = [\n "cyperlink-policy-authoring",\n]\n';await writeFile(join(work,'Cargo.lock'),lock);
 return{directory,manifest,source,work};
}
export async function testPackage(directory){const staged=await stageCompiler(directory);const log=join(staged.work,'test.log');await command(join(process.env.HOME,'.cargo/bin/cargo'),['run','--locked','--offline','--manifest-path',join(staged.work,'Cargo.toml'),'--','test',join(staged.directory,'tests.json')],{env:{CARGO_TARGET_DIR:join(ROOT,'.local/policy-package-target')},log});return{passed:true,evidence:'host-IR-only-not-distributed',log};}
export async function buildPackage(directory){
 const platformBefore=await platformSources();
 const staged=await stageCompiler(directory),circuits=join(staged.work,'circuits');await mkdir(circuits);
 const started=Date.now();await command(join(process.env.HOME,'.cargo/bin/cargo'),['run','--locked','--offline','--manifest-path',join(staged.work,'Cargo.toml'),'--','build',circuits],{env:{CARGO_TARGET_DIR:join(ROOT,'.local/policy-package-target')},log:join(staged.work,'build.log')});
 assert.deepEqual(await platformSources(),platformBefore,'Platform changed while compiling; preserve work and rebuild');
 const artifacts={};for(const stem of['runtime_policy_init','runtime_policy_evaluate'])for(const suffix of['arcis','idarc','hash','weight']){const file=`${stem}.${suffix}`,bytes=await readFile(join(circuits,file));artifacts[file]={sha256:sha(bytes),bytes:bytes.length};}
 const body={schema:1,package:staged.manifest,sourceSha256:sha(staged.source),schemaHashHex:schemaDigest(staged.manifest.stateFields),platformSources:platformBefore,artifacts};
 const releaseHashHex=sha(canonical(body)),release={...body,releaseHashHex};
 const target=join(staged.directory,'.cyperlink/releases',releaseHashHex);await mkdir(dirname(target),{recursive:true});let reused=false;try{await rename(staged.work,target);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;assert.deepEqual(await json(join(target,'release.json')),release,'Existing release is corrupt');for(const[name,record]of Object.entries(artifacts))assert.equal(sha(await readFile(join(target,'circuits',name))),record.sha256);reused=true;}
 if(!reused)await freshJson(join(target,'release.json'),release);await writeFile(join(staged.directory,'.cyperlink/current.json'),JSON.stringify({releaseHashHex},null,2)+'\n');
 await generateBindings(staged.directory,release);
 return{releaseHashHex,schemaHashHex:body.schemaHashHex,releaseDirectory:target,compilationMs:Date.now()-started,evidence:'compiled-artifacts-not-runtime'};
}
export async function readRelease(directory,{checkPlatform=true}={}){
 directory=resolve(directory);const current=await json(join(directory,'.cyperlink/current.json'));assert(/^[a-f0-9]{64}$/.test(current.releaseHashHex));
 const releaseDirectory=join(directory,'.cyperlink/releases',current.releaseHashHex),release=await json(join(releaseDirectory,'release.json'));const{releaseHashHex,...body}=release;
 assert.equal(releaseHashHex,current.releaseHashHex);assert.equal(sha(canonical(body)),releaseHashHex,'Release manifest was altered');validateManifest(release.package);assert.equal(schemaDigest(release.package.stateFields),release.schemaHashHex);
 assert.equal(sha(await readFile(join(directory,'policy.rs'))),release.sourceSha256,'Source changed; build a fresh release');assert.deepEqual(await json(join(directory,'policy.json')),release.package,'Package manifest changed; rebuild');
 if(checkPlatform)assert.deepEqual(await platformSources(),release.platformSources,'Platform source changed; rebuild before deployment');
 for(const [name,record]of Object.entries(release.artifacts)){assert(/^runtime_policy_(init|evaluate)\.(arcis|idarc|hash|weight)$/.test(name));const bytes=await readFile(join(releaseDirectory,'circuits',name));assert.equal(sha(bytes),record.sha256,'Artifact bytes changed');assert.equal(bytes.length,record.bytes);}
 assert.equal(Object.keys(release.artifacts).length,8);return{release,releaseDirectory};
}
async function generateBindings(directory,release){
 const dest=join(directory,'.cyperlink'),module=join(ROOT,'packages/policy-client/src/index.mjs');
 await writeFile(join(dest,'bindings.mjs'),`// Generated local bindings. Package identity excludes this machine-specific import path.\nimport { PolicyOperationClient } from ${JSON.stringify(module)};\nexport const releaseHashHex=${JSON.stringify(release.releaseHashHex)};\nexport const stateFields=${JSON.stringify(release.package.stateFields)};\nexport async function connect(options){if(options.deployment.releaseHashHex!==releaseHashHex)throw Error('Selected deployment belongs to a different policy release');return PolicyOperationClient.connect(options);}\n`);
 await writeFile(join(dest,'bindings.d.mts'),`// Generated policy-specific private initializer shape. Values stay client-side.\nexport interface PrivateInitialState {\n${release.package.stateFields.map(f=>`  ${f.name}: bigint;`).join('\n')}\n}\nexport declare const releaseHashHex: string;\nexport declare const stateFields: readonly {name:string,type:'u64'}[];\nexport declare function connect(options: Parameters<typeof import(${JSON.stringify(module)}).PolicyOperationClient.connect>[0]): ReturnType<typeof import(${JSON.stringify(module)}).PolicyOperationClient.connect>;\n`);
}
