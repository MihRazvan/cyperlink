#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initPackage, buildPackage, testPackage, repairPackage } from './src/package.mjs';

const args = process.argv.slice(2);
const [group, action, directory, ...flags] = args;
try {
  if (group === 'console' || group === 'service') {
    const entry = group === 'console' ? '../../apps/console/server.mjs' : '../service/server.mjs';
    const { main } = await import(entry);
    await main(args.slice(1));
  } else if (group === 'runtime') {
    const script = fileURLToPath(new URL('../../scripts/runtime_local.py', import.meta.url));
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn('python3', [script, ...args.slice(1)], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } else {
    if (group !== 'policy' || !directory || !['init', 'build', 'test', 'repair', 'deploy'].includes(action)) {
      throw Error('Usage: cyperlink policy init|build|test|repair|deploy <directory>; runtime <action> --environment <directory>; service --config <file>; console <options>');
    }
    let result;
    if (action === 'deploy') {
      const { deployPackage } = await import('./src/deploy.mjs');
      const options = {};
      for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        if (flag === '--local' && !options.local) { options.local = true; continue; }
        if (!['--environment', '--initial-state', '--out', '--module-root'].includes(flag) || !flags[i + 1] || flags[i + 1].startsWith('--') || Object.hasOwn(options, flag)) throw Error('Unsupported or duplicate deployment option');
        options[flag] = flags[++i];
      }
      result = await deployPackage(directory, options);
    } else {
      if (flags.length) throw Error('Unexpected options');
      result = await ({ init: initPackage, build: buildPackage, test: testPackage, repair: repairPackage }[action])(directory);
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
