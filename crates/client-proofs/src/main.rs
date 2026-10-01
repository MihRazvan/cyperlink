use cyperlink_client_proofs::{
    configure_proof, prepare_transfer, provision_plan, read_public_key, write_new, ClientKeys,
    Result, TransferAddresses,
};
use serde_json::{json, Value};
use solana_address::Address;
use std::{collections::BTreeMap, path::Path};

fn text<'a>(request: &'a Value, name: &str) -> Result<&'a str> {
    request[name]
        .as_str()
        .ok_or_else(|| format!("request requires string {name}").into())
}
fn address(request: &Value, name: &str) -> Result<Address> {
    Ok(text(request, name)?.parse()?)
}
fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args
        .next()
        .ok_or("commands: create-keys, provision-plan, configure-proof, prepare-transfer")?;
    let mut options = BTreeMap::new();
    while let Some(name) = args.next() {
        if !name.starts_with("--") || options.contains_key(&name) {
            return Err("expected unique --option value pairs".into());
        }
        options.insert(name, args.next().ok_or("missing option value")?);
    }
    let option = |name: &str| -> Result<&str> {
        options
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| format!("missing {name}").into())
    };
    let allowed: &[&str] = match command.as_str() {
        "create-keys" => &["--keys"],
        "configure-proof" | "provision-plan" => &["--keys", "--request", "--output"],
        "prepare-transfer" => &[
            "--keys",
            "--request",
            "--source-account",
            "--output",
            "--witness",
        ],
        _ => {
            return Err(
                "commands: create-keys, provision-plan, configure-proof, prepare-transfer".into(),
            )
        }
    };
    if options.keys().any(|name| !allowed.contains(&name.as_str())) {
        return Err("unknown option for command".into());
    }
    if command == "create-keys" {
        let keys = ClientKeys::generate();
        keys.save_new(Path::new(option("--keys")?))?;
        println!(
            "{}",
            json!({"created":true,"elgamal_pubkey":keys.public_key_hex()})
        );
        return Ok(());
    }
    let keys = ClientKeys::load(Path::new(option("--keys")?))?;
    let request: Value = serde_json::from_slice(&std::fs::read(option("--request")?)?)?;
    let output = Path::new(option("--output")?);
    if output.exists() {
        return Err("output already exists; choose a fresh operation path".into());
    }
    let public = if command == "provision-plan" {
        let initial_amount = request["initial_amount"]
            .as_u64()
            .ok_or("initial_amount must be an unsigned integer")?;
        let decimals: u8 = request["decimals"].as_u64().unwrap_or(0).try_into()?;
        provision_plan(
            &keys,
            &address(&request, "source")?,
            &address(&request, "mint")?,
            &address(&request, "owner")?,
            &address(&request, "pubkey_context")?,
            &address(&request, "mint_authority")?,
            &address(&request, "hook_program")?,
            initial_amount,
            decimals,
            request["max_pending_credits"].as_u64().unwrap_or(100),
        )?
    } else if command == "configure-proof" {
        let max = request["max_pending_credits"].as_u64().unwrap_or(100);
        configure_proof(
            &keys,
            &address(&request, "source")?,
            &address(&request, "mint")?,
            &address(&request, "owner")?,
            &address(&request, "pubkey_context")?,
            max,
        )?
    } else {
        let addresses = TransferAddresses {
            source: address(&request, "source")?,
            mint: address(&request, "mint")?,
            destination: address(&request, "destination")?,
            owner: address(&request, "owner")?,
            equality: address(&request, "equality")?,
            grouped: address(&request, "grouped")?,
            range: address(&request, "range")?,
        };
        let amount = request["amount"]
            .as_u64()
            .ok_or("amount must be an unsigned integer")?;
        let destination = read_public_key(text(&request, "destination_elgamal_pubkey")?)?;
        let auditor = request
            .get("auditor_elgamal_pubkey")
            .filter(|v| !v.is_null())
            .map(|v| {
                v.as_str()
                    .ok_or("auditor key must be a hex string")
                    .map_err(Into::into)
                    .and_then(read_public_key)
            })
            .transpose()?;
        let prepared = prepare_transfer(
            &keys,
            &std::fs::read(option("--source-account")?)?,
            amount,
            &addresses,
            &destination,
            auditor.as_ref(),
        )?;
        prepared.witness.save_new(Path::new(option("--witness")?))?;
        prepared.public
    };
    write_new(output, &serde_json::to_vec_pretty(&public)?, false)?;
    println!(
        "{}",
        json!({"prepared":true,"evidence_level":"client-proof-preparation-only"})
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("client proof preparation failed: {error}");
        std::process::exit(1);
    }
}
