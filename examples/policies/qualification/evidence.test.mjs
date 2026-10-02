import test from 'node:test';
import assert from 'node:assert/strict';
import { businessState, unchanged, costs } from './evidence.mjs';
import { parseArguments } from '../qualify.mjs';
test('business-state comparison excludes only admission counter and binds extra encrypted slots',()=>{
 const original=Buffer.alloc(353),basis=businessState(original);
 for(let i=0;i<353;i++){const next=Buffer.from(original);next[i]=1;assert.equal(basis.equals(businessState(next)),i>=88&&i<96,`byte ${i}`);}
 assert.throws(()=>businessState(Buffer.alloc(161)));
});
test('rollback evidence requires the same full account set, bytes and ownership; slots may advance',()=>{
 const before={context:{slot:1},accounts:[{address:'a',owner:'h',dataBase64:'AAAA',lamports:1},{address:'b',absent:true}]};
 unchanged(before,{...before,context:{slot:2}});
 for(const accounts of [[{...before.accounts[0],dataBase64:'AAAB'},before.accounts[1]],[{...before.accounts[0],owner:'other'},before.accounts[1]],[before.accounts[0],{address:'b',dataBase64:''}],before.accounts.slice(0,1)])assert.throws(()=>unchanged(before,{accounts}));
});
test('costs separate actual callback, native settlement and proof/provisioning records',()=>{
 const result=costs({transactions:[{category:'native-proof-and-operation-provisioning',landedCU:11,feeLamports:5},{category:'native-settlement',landedCU:22,feeLamports:6}],callbacks:[{landedCU:33,feeLamports:7,elapsedFromQueueMs:5000}]});
 assert.deepEqual(result,{'native-proof-and-operation-provisioning':{transactions:1,landedCU:11,feeLamports:5},'native-settlement':{transactions:1,landedCU:22,feeLamports:6},'arcium-signed-callback':{transactions:1,landedCU:33,feeLamports:7}});
});
test('qualification CLI requires explicit coexisting deployment manifests and private output',()=>{
 const value=parseArguments(['--deployments','one.json,two.json','--out','.local/qualification']);assert.equal(value.deployments.length,2);assert(value.deployments.every(p=>p.startsWith('/')));assert.equal(value.scenario,'combined');
 for(const args of[[],['--out','x'],['--deployments','a,b','--out','x','--network','mainnet'],['--deployments','a,b','--out','x','--out','y']])assert.throws(()=>parseArguments(args));
});
