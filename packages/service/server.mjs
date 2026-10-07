#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateJson } from '../local-client/src/private-store.mjs';
import { startService } from './src/index.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--config') throw Error('Use service --config PRIVATE_LOCAL_CONFIG_JSON');
  const config = await privateJson(resolve(args[1]));
  if (config.schema !== 1 || Object.keys(config).some(key => !['schema', 'directory', 'sources', 'port', 'token'].includes(key))) throw Error('Unsupported local API configuration.');
  const { schema, ...options } = config;
  const server = await startService(options);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void server.close().then(() => process.exit(0), () => process.exit(1));
  });
  console.log(`CyperLink local API: ${server.url}/v1/projects`);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('CyperLink API could not start. Check the private configuration, workspace lock and local runtime.'); process.exitCode = 1; });
}
