#!/usr/bin/env node
import { initPackage, buildPackage, testPackage } from './src/package.mjs';
const [group,action,directory,...flags]=process.argv.slice(2);
try {
 if(group==='console') { const { main } = await import('../../apps/console/server.mjs'); await main(process.argv.slice(3)); } else {
 if(group!=='policy'||!directory||!['init','build','test','deploy'].includes(action))throw Error('Usage: cyperlink policy init|build|test|deploy <directory>');
 let result;
 if(action==='deploy') {const {deployPackage}=await import('./src/deploy.mjs');const options={};for(let i=0;i<flags.length;i++){const flag=flags[i];if(flag==='--local'){options.local=true;continue;}if(!['--environment','--initial-state','--out','--module-root'].includes(flag)||!flags[i+1]||options[flag])throw Error('Unsupported deployment option');options[flag]=flags[++i];}result=await deployPackage(directory,options);}
 else {if(flags.length)throw Error('Unexpected options');result=await({init:initPackage,build:buildPackage,test:testPackage}[action])(directory);}
 console.log(JSON.stringify(result,null,2));
 }
} catch(error){console.error(error.message);process.exitCode=1;}
