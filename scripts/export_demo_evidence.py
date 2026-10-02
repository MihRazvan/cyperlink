#!/usr/bin/env python3
"""Export allowlisted public demo evidence; never read keys, witnesses, or raw wire files."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SCALAR = None

def fields(names):
    return {name: SCALAR for name in names.split()}

TRANSACTION = fields('label category signature bytes slot signaturesVerified simulatedCU landedCU feeLamports')
OPERATION = fields('label kind requestedAmountObserverDisclosure status source destination permit job consumer record quotaVersionAtAdmission')
DESCRIPTOR = fields('profile consumerKind job computation permit owner admin quota effect templateHex inputsHashHex queryStateHashHex sku productHex32 licenseExpirySlot')
OBSERVATION = fields('status slot commitment job permit effect consumerKind licenseExpirySlot licenseActive quotaVersion expectedQuotaVersion actions reason')
CHECK = fields('label address lamports evidence_level simulatedCU actualCustomError consumerPdaRecomputed allTrackedDataUnchanged allFiveAccountDataUnchanged changedAccounts') | {'observation': OBSERVATION}
CALLBACK = fields('label job computation signature status elapsedFromQueueMs slot landedCU feeLamports') | {'output': fields('field0 field1 field2')}
LOADED = fields('matched program_owner programdata last_deploy_slot elf_bytes elf_sha256 loaded_elf_sha256 loaded_account_payload_sha256 padding_zero_bytes program rpc_slot genesis_hash evidence_level executes_program')
ACCOUNT = fields('address owner executable lamports dataBase64')
SNAPSHOT = fields('label commitment') | {'context': fields('apiVersion slot'), 'accounts': [ACCOUNT]}
QUERY_SNAPSHOT = fields('slot commitment addresses trackedAddresses') | {'accounts': [('nullable', ACCOUNT)]}
QUERY_REJECTION = fields('actualCustomError signature exactSignedWireReused jobPermitClaimAndComputationAbsent quotaAndPermitUnchanged trackedAddresses operationLabel') | {
    'before': QUERY_SNAPSHOT, 'after': QUERY_SNAPSHOT, 'descriptor': DESCRIPTOR,
}
RECOVERY = fields('label schema processId action evidenceLevel genesisHash generatesKeysProofsOrOperationIdentity createsNewSignedTransaction passed') | {
    'retainedPlan': fields('sha256 bytes'), 'retainedTicket': fields('sha256 bytes'),
    'identity': fields('job computation permit owner quota effect'), 'observation': OBSERVATION,
    'delivery': fields('status canBroadcast attempts signature role descriptorSha256 wireSha256 lastSendError') | {
        'retryPolicy': fields('maxBroadcasts rpcMaxRetries'),
        'broadcasts': [fields('attempt rpcMaxRetries startedAt') | {'response': ('nullable', fields('signature wireSha256 attempt completedAt outcome returnedSignature') | {'error': fields('name message code')})}],
        'semanticBinding': fields('role wireSha256 descriptorSha256 instructionSha256 liveLookupTablesChecked'),
        'receipt': fields('slot landedCU feeLamports'),
    },
}
QUOTA = fields('version counter nonce stateHash ciphertext')
CATEGORIES = ('adversarial-prefunding-setup', 'application', 'arcium-definition', 'arcium-circuit-upload', 'arcium-queue', 'lookup-table', 'adversarial-consumer-binding', 'adversarial-native-settlement', 'native-settlement', 'native-provisioning', 'native-proof-and-permit-provisioning', 'arcium-signed-callback')


def project(value, schema):
    """Only schema-listed fields cross this boundary, including nested objects."""
    if isinstance(schema, tuple) and schema[0] == 'nullable':
        return None if value is None else project(value, schema[1])
    if schema is None:
        if isinstance(value, list):
            if any(isinstance(item, (dict, list)) for item in value):
                raise ValueError('Expected list of public scalar values')
            return value[:]
        if isinstance(value, dict):
            raise ValueError('Unexpected object in public scalar field')
        return value
    if isinstance(schema, list):
        return [project(item, schema[0]) for item in value]
    return {key: project(value[key], subschema) for key, subschema in schema.items() if key in value}


def digest(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def relative(path):
    return path.resolve().relative_to(ROOT).as_posix()


def source_manifest(source):
    result = {'commit': source['commit'], 'files': {}}
    if not re.fullmatch(r'[0-9a-f]{40}', result['commit']):
        raise ValueError('Invalid source commit')
    for path, checksum in source['files'].items():
        if not re.fullmatch(r'(?:crates|programs)/[A-Za-z0-9_./-]+\.(?:rs|toml|lock)', path) or '..' in Path(path).parts:
            raise ValueError('Unexpected source manifest path')
        if not re.fullmatch(r'[0-9a-f]{64}', checksum):
            raise ValueError('Invalid source checksum')
        result['files'][path] = checksum
    return result


def error_summary(error):
    if error is None:
        return None
    instruction = error.get('InstructionError') if isinstance(error, dict) else None
    if not isinstance(instruction, list) or len(instruction) != 2 or not isinstance(instruction[0], int):
        raise ValueError('Unsupported transaction error shape')
    detail = instruction[1]
    if isinstance(detail, dict):
        if type(detail.get('Custom')) is not int:
            raise ValueError('Unsupported custom error shape')
        detail = {'Custom': detail['Custom']}
    elif not isinstance(detail, str):
        raise ValueError('Unsupported instruction error detail')
    return {'InstructionError': [instruction[0], detail]}


def recovery_summary(value):
    result = project(value, RECOVERY)
    receipt = value.get('delivery', {}).get('receipt')
    if receipt is not None:
        result['delivery']['receipt']['error'] = error_summary(receipt.get('error'))
    return result


def build_report(raw, preparation, sources, client_manifest, descriptors, provenance):
    if raw.get('passed') is not True:
        raise ValueError('Only a completed passing run may be exported')
    if raw.get('scenario') not in ('conflict', 'compatible'):
        raise ValueError('Unsupported demo scenario')
    if preparation.get('bootstrap') != 'fresh-upstream-generated' or preparation.get('research_checkout_required') is not False:
        raise ValueError('Expected fresh generated bootstrap without research checkout')
    result = project(raw, fields('schema_version passed scenario evidence_level scope genesis_hash idl_sha256 runtime_mxe_public_key_hex limitations') | {
        'validator': fields('feature-set solana-core'), 'loaded_programs': [LOADED], 'operations': [OPERATION],
        'observer_disclosures': fields('initial_allowance purchase_amounts note inferred_remaining_allowance'),
        'callbacks': [CALLBACK], 'checks': [CHECK], 'accountSnapshots': [SNAPSHOT],
    })
    result['final_quota'] = project(raw['finalQuota'], QUOTA)
    result['validator_cost_by_category'] = project(raw['validatorCostByCategory'], {category: fields('transactions landedCU feeLamports') for category in CATEGORIES})
    result['critical_transactions'] = []
    for tx in raw['transactions']:
        if tx.get('category') == 'arcium-circuit-upload':
            continue
        record = project(tx, TRANSACTION)
        record['error'] = error_summary(tx.get('error'))
        result['critical_transactions'].append(record)
    result['executed_client_source_manifest'] = project(client_manifest, [fields('path bytes sha256')])
    result['compiled_program_source_manifest'] = source_manifest(sources)
    result['locally_retained_operation_descriptors'] = [project(d, DESCRIPTOR | fields('path')) for d in descriptors]
    result['cost_scope'] = ('Validator CU and fees are separate by category. Callback elapsed time is queue-to-observed committed callback including polling/RPC overhead. Distributed worker CPU, preprocessing, network traffic and production pricing are not measured.')
    result['bootstrap_provenance'] = provenance
    if 'recoveries' in raw:
        result['recoveries'] = [recovery_summary(value) for value in raw['recoveries']]
        result['recovery_evidence_scope'] = (
            'Worker results come from separate local Node processes and retained operation plans/signed tickets. '
            'Dropped send responses are deliberate test fault injection after invoking the real local RPC send; '
            'transaction receipt fields describe actual signed local-validator transactions. '
            'Read-only recovery never broadcasts; submit-ticket may broadcast only the retained signed bytes. '
            'A passing recovery check is not itself evidence of payment; the SDK observation distinguishes application state.')
    if 'querySnapshotRejection' in raw:
        result['querySnapshotRejection'] = project(raw['querySnapshotRejection'], QUERY_REJECTION)
    return result


def bootstrap_provenance(preparation_path, preparation):
    app = preparation_path.parent / 'app'
    generation_path = app / 'generation.json'
    generation = json.loads(generation_path.read_text())
    if digest(generation_path)['sha256'] != preparation['generation_manifest_sha256']:
        raise ValueError('Generation manifest hash mismatch')
    result = project(preparation, fields('scope profile bootstrap research_checkout_required run_id compose_project subnet payer genesis_accounts generation_manifest_sha256 validator_sha256'))
    result['preparation'] = {'path': relative(preparation_path), **digest(preparation_path)}
    result['generation'] = project(generation, fields('schema scope payer auth_program cluster_offset nodes recovery_identity_count cached_mxe_keys arcium_version arcium_cli_sha256 keygen_sha256 limitations') | {'elf_sha256': fields('arcium staking lighthouse')})
    result['public_ip_patches'] = project(preparation['public_ip_patches'], [fields('file offset old new')])
    result['deployments'] = project(preparation['deployments'], [fields('address upgradeable sha256')])
    result['staged_public_genesis'] = project(preparation['staged_public_genesis'], [fields('pubkey owner data_bytes sha256 staged_sha256')])
    # Hash only named public configuration/source files, never recurse over runtime keys.
    names = ('scripts/generate_runtime.py', 'scripts/prepare_localnet.py', 'scripts/setup_local_toolchain.py', 'scripts/setup_local_js.py', 'scripts/build_local.py', 'config/local-toolchain.json')
    result['support_files_at_export'] = [{'path': name, **digest(ROOT / name)} for name in names]
    result['support_files_qualification'] = 'Hashes observed at export time; not asserted to be source snapshots captured before generation.'
    result['staged_public_configuration'] = [{'path': relative(app / name), **digest(app / name)} for name in ('Arcium.toml', 'Anchor.toml', 'genesis-args.json', 'validator-command.json', 'run-validator.py')]
    return result


def write_report(output, report):
    # Exclusive creation prevents accidental replacement of already published evidence.
    with output.open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')


def summarize_final_accounts(value):
    result = project(value, fields('scope') | {'observations': [fields('name') | {'observation': OBSERVATION}]})
    result['snapshot_summary'] = project(value['snapshot'], fields('slot commitment'))
    result['snapshot_summary']['account_count'] = len(value['snapshot']['accounts'])
    result['snapshot_summary']['qualification'] = 'Account bytes remain in the hash-identified local evidence file; this is a summary, not an exported account snapshot.'
    return result


def export(results_path, preparation_path, output):
    raw = json.loads(results_path.read_text())
    preparation = json.loads(preparation_path.read_text())
    source_path = preparation_path.with_name('source-hashes.json')
    client_path = results_path.with_name('client-source-manifest.json')
    sources = json.loads(source_path.read_text())
    clients = json.loads(client_path.read_text())
    descriptors = []
    for operation in raw['operations']:
        label = operation['label']
        if not re.fullmatch(r'[a-z0-9-]+', label):
            raise ValueError('Unsafe operation label')
        path = results_path.parent / f'operation-{label}' / 'operation-descriptor.json'
        descriptor = project(json.loads(path.read_text()), DESCRIPTOR)
        descriptor['path'] = relative(path)
        descriptors.append(descriptor)
    report = build_report(raw, preparation, sources, clients, descriptors, bootstrap_provenance(preparation_path, preparation))
    report['full_evidence'] = {'path': relative(results_path), **digest(results_path)}
    report['exporter'] = {'path': 'scripts/export_demo_evidence.py', **digest(Path(__file__))}
    final_account_path = results_path.with_name('final-account-evidence.json')
    if final_account_path.exists():
        final_accounts = json.loads(final_account_path.read_text())
        report['independent_final_account_evidence'] = {
            'path': relative(final_account_path), **digest(final_account_path),
            **summarize_final_accounts(final_accounts),
        }
    write_report(output, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', required=True, type=Path)
    parser.add_argument('--preparation', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    report = export(args.results, args.preparation, args.out)
    print(json.dumps({'passed': report['passed'], 'scenario': report['scenario'], 'output': str(args.out), **digest(args.out)}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'Public evidence export failed: {error}', file=sys.stderr)
        sys.exit(1)
