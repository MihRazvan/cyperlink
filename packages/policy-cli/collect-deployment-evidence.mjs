#!/usr/bin/env node
// Read-only retrospective CLI deployment cost capture; never exports CLI seed text.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadWeb3, loopbackEndpoint, writeNew, REPO } from '../local-client/src/runtime.mjs';
const [instancePath, outputPath] = process.argv.slice(2);
assert(instancePath && outputPath, 'Usage: collect-deployment-evidence.mjs INSTANCE OUTPUT');
assert(resolve(outputPath).startsWith(resolve(REPO,'.local')+'/'),'Evidence output must be under ignored .local');
const instance=JSON.parse(await readFile(instancePath,'utf8')),base=dirname(resolve(instancePath));
const web3=await loadWeb3(instance.moduleRoot),connection=new web3.Connection(loopbackEndpoint(instance.endpoint),'confirmed');
assert.equal(await connection.getGenesisHash(),instance.descriptor.genesisHash);
const transactions=[],seen=new Set();
for(const name of ['auth','policy','guard','merchant','license']) {
 const log=await readFile(resolve(base,`deploy-${name}.log`),'utf8');
 const buffer=log.match(/solana program close ([1-9A-HJ-NP-Za-km-z]{32,44})/);
 assert(buffer,'CLI deployment buffer address unavailable; no complete program-write cost claim');
 for(const address of [instance.descriptor.programs[name],buffer[1]]) {
  let before;
  for(;;) {
   const batch=await connection.getSignaturesForAddress(new web3.PublicKey(address),{limit:1000,...(before?{before}:{})},'confirmed');
   for(const item of batch) {
    if(seen.has(item.signature))continue;
    const tx=await connection.getTransaction(item.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});assert(tx);
    // Program addresses also appear in subsequent application calls; only this
    // loader's instructions qualify as program deployment/setup costs.
    const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
    if(!tx.transaction.message.compiledInstructions.some(ix=>keys.get(ix.programIdIndex).toBase58()==='BPFLoaderUpgradeab1e11111111111111111111111'))continue;
    seen.add(item.signature);transactions.push({signature:item.signature,label:`${name}-program-deployment`,category:'program-deployment',slot:tx.slot,landedCU:tx.meta.computeUnitsConsumed??0,feeLamports:tx.meta.fee,transaction:tx});
   }
   if(batch.length<1000)break;before=batch.at(-1).signature;
  }
 }
}
for(const kind of ['merchant','license'])for(const filename of await readdir(instance.assetDirectories[kind])) {
 if(!filename.endsWith('-landed.json'))continue;
 const tx=JSON.parse(await readFile(resolve(instance.assetDirectories[kind],filename),'utf8'));if(seen.has(tx.signature))continue;seen.add(tx.signature);
 transactions.push({...tx,category:'native-asset-provisioning',feeLamports:tx.transaction.meta.fee});
}
const totals={};for(const tx of transactions){const t=totals[tx.category]??={transactions:0,landedCU:0,feeLamports:0,failedTransactions:0};t.transactions++;t.landedCU+=tx.landedCU;t.feeLamports+=tx.feeLamports;t.failedTransactions+=Number(Boolean(tx.transaction.meta.err));}
await writeNew(resolve(outputPath),JSON.stringify({schema:1,qualification:'read-only-confirmed-rpc-deployment-receipts',genesisHash:instance.descriptor.genesisHash,transactions,totals,limitations:['Validator transaction costs only; rent/funding are not transaction fees','No distributed runtime resource-price or public-network claim']},null,2));
console.log(JSON.stringify(totals));
