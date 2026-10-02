#!/usr/bin/env python3
"""Stage one generated custom-policy deployment; never sign or deploy."""
import argparse
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(__file__).resolve().parent
FIELDS = ['auth', 'policy', 'guard', 'quota', 'merchant', 'license', 'release', 'schema', 'domain']

def base58(raw):
    n = int.from_bytes(raw, 'big'); result = ''
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    while n:
        n, r = divmod(n, 58); result = alphabet[r] + result
    return '1' * (len(raw) - len(raw.lstrip(b'\0'))) + result

def stage(config_path, output, circuits):
    config = json.loads(config_path.read_text())
    for name in FIELDS:
        value = config.get(name)
        if not isinstance(value, list) or len(value) != 32 or any(type(v) is not int or not 0 <= v <= 255 for v in value):
            raise ValueError(f'{name} must contain exactly32 byte integers')
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.local'):
        raise ValueError('Generated programs must be under repository .local')
    output.mkdir(parents=True, exist_ok=False)
    for name in ['native', 'auth']:
        shutil.copytree(BASE / name, output / name, ignore=shutil.ignore_patterns('target', 'build', 'deployment.rs'))
    for manifest in output.rglob('Cargo.toml'):
        text = manifest.read_text()
        for prefix in ['../../../../../crates/', '../../../../crates/']:
            text = text.replace(prefix, str(ROOT / 'crates') + '/')
        manifest.write_text(text)
    constants = '\n'.join(f'pub const {name.upper()}_ID:[u8;32]={config[name]};' for name in FIELDS) + '\n'
    (output / 'native/deployment.rs').write_text(constants)
    auth = f'declare_id!("{base58(bytes(config["auth"]))}");\n' + constants + '\nconst H:Pubkey=Pubkey::new_from_array(POLICY_ID);\nconst Q:Pubkey=Pubkey::new_from_array(QUOTA_ID);\n'
    (output / 'auth/programs/cyperlink_auth/src/deployment.rs').write_text(auth)
    anchor = (output / 'auth/Anchor.toml').read_text()
    anchor = anchor.replace('5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ', base58(bytes(config['auth'])))
    (output / 'auth/Anchor.toml').write_text(anchor)
    build = output / 'auth/build'; build.mkdir()
    for stem in ['runtime_policy_init', 'runtime_policy_evaluate']:
        for suffix in ['.arcis', '.idarc', '.hash', '.weight']:
            shutil.copyfile(circuits / (stem + suffix), build / (stem + suffix))
    (output / 'deployment.json').write_text(json.dumps(config, indent=2) + '\n')
    return output

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--circuits',type=Path,required=True)
    args=parser.parse_args()
    print(stage(args.config,args.out,args.circuits))
