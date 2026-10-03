/** Qualification only: SIGKILL after exact target's atomic link and directory fsync. */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, dirname } from 'node:path';
const config=JSON.parse(fs.readFileSync(process.env.CYPERLINK_DIRECT_CRASH_FILE,'utf8'));
const local=resolve('.local')+'/';
if(!resolve(config.target).startsWith(local)||!resolve(config.log).startsWith(local)||!['before-wire','after-wire','after-simulation'].includes(config.phase))throw Error('Invalid local crash configuration');
const open=fs.promises.open.bind(fs.promises),link=fs.promises.link.bind(fs.promises);let linked=false;
function crash(){const fd=fs.openSync(config.log,'ax',0o600);try{fs.writeSync(fd,JSON.stringify({phase:config.phase,target:config.target,pid:process.pid,signal:'SIGKILL',at:new Date().toISOString()})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}process.kill(process.pid,'SIGKILL');}
fs.promises.link=async (from,to)=>{if(resolve(to)===resolve(config.target)&&config.phase==='before-wire')crash();const result=await link(from,to);if(resolve(to)===resolve(config.target))linked=true;return result;};
fs.promises.open=async (path,...args)=>{const handle=await open(path,...args);if(resolve(String(path))===dirname(resolve(config.target))){const sync=handle.sync.bind(handle);handle.sync=async()=>{const value=await sync();if(linked)crash();return value;};}return handle;};
syncBuiltinESMExports();
