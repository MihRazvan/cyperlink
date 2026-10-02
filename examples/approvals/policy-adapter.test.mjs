import test from 'node:test';
import assert from 'node:assert/strict';
import { policyBootstrap } from './policy-adapter.mjs';
import { canonicalHash, policyDomainHash } from '../../packages/policy-client/src/deployment.mjs';
import { plan } from '../../packages/policy-client/test/fixture.mjs';
import { TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';

// Synthetic host manifests and byte-identification reports, never validator evidence.
function fixture() {
  const descriptor = plan().descriptor.deployment;
  const body = { schema:1, schemaHashHex:descriptor.schemaHashHex, package:{ name:'private-rule', profile:descriptor.profile, stateFields:descriptor.stateFields }, artifacts:{} };
  const release = {...body,releaseHashHex:canonicalHash(body)};
  descriptor.releaseHashHex=release.releaseHashHex;descriptor.domainHashHex=policyDomainHash(descriptor);
  const instance={schema:1,passed:true,descriptor,endpoint:'http://127.0.0.1:8899',results:'/Users/razvan/Repos/cyperlink/.local/synthetic-policy/results.json',policyName:'private-rule'};
  const programs=[...new Set(Object.values(descriptor.programs)),TOKEN_PROGRAM,'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ','ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq'];
  const results={passed:true,phase:'ready',genesisHash:descriptor.genesisHash,releaseHashHex:descriptor.releaseHashHex,descriptor:structuredClone(descriptor),loadedPrograms:programs.map(program=>({program,matched:true,genesis_hash:descriptor.genesisHash,elf_sha256:'ab'.repeat(32),loaded_elf_sha256:'ab'.repeat(32),local_elf_path:'/synthetic-host-only/program.so'}))};
  return {instance,results,release};
}
test('custom adapter derives public policy identity from matching completed release and nine program reports',()=>{
  const {instance,results,release}=fixture(), bootstrap=policyBootstrap(instance,results,release);
  assert.equal(bootstrap.policy.name,'private-rule');assert.equal(bootstrap.loadedPrograms.length,9);
  assert.equal(bootstrap.genesisHash,instance.descriptor.genesisHash);
  assert.equal(bootstrap.policy.release,instance.descriptor.releaseHashHex);
  assert.equal(bootstrap.initialAllowance,undefined);assert.equal(bootstrap.observerDisclosures,undefined);
});
test('custom adapter rejects incomplete deployments, renamed rules and transplanted or altered provenance',()=>{
  for(const mutate of [f=>f.results.passed=false,f=>f.results.phase='initializing-private-state',f=>f.instance.policyName='other-rule',
    f=>f.release.package.name='edited-rule',f=>f.results.descriptor.programs.merchant=f.results.descriptor.programs.license,
    f=>f.results.loadedPrograms.pop(),f=>f.results.loadedPrograms[0].program=f.results.loadedPrograms[1].program,
    f=>f.results.loadedPrograms[0].genesis_hash='another-ledger',f=>f.results.loadedPrograms[0].loaded_elf_sha256='cd'.repeat(32),
    f=>f.instance.endpoint='https://api.mainnet-beta.solana.com']){
      const f=fixture();mutate(f);assert.throws(()=>policyBootstrap(f.instance,f.results,f.release));
  }
});
