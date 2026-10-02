//! Explicit synthetic host testing. Never called to decide a live operation.
use super::*;
use arcis_compiler::{
    core::expressions::domain::DomainElement, utils::number::Number, DefaultConfig, EvalValue,
};
use rustc_hash::FxHashMap;
use serde_json::{json, Value};
use solana_zk_sdk::encryption::pedersen::{Pedersen, PedersenOpening};
fn number(value: &Value) -> Result<u128, String> {
    if let Some(value) = value.as_str() {
        value
            .parse()
            .map_err(|_| "invalid unsigned integer string".into())
    } else {
        value
            .as_u64()
            .map(u128::from)
            .ok_or("use an unsigned integer or decimal string".into())
    }
}
fn scalar(value: u128) -> ScalarField {
    ScalarField::from(Number::from(value))
}
pub fn test_vectors(
    fields: &[&str],
    rule: Rule,
    path: impl AsRef<std::path::Path>,
) -> Result<Value, String> {
    let json = std::fs::read(path).map_err(|error| error.to_string())?;
    test_vectors_json(
        fields,
        rule,
        &serde_json::from_slice(&json).map_err(|error| error.to_string())?,
    )
}
pub fn test_vectors_json(fields: &[&str], rule: Rule, vectors: &Value) -> Result<Value, String> {
    validate_schema(fields)?;
    let ir = host_ir(fields, rule);
    let cases = vectors.as_array().ok_or("test vectors must be an array")?;
    if cases.is_empty() {
        return Err("at least one test vector is required".into());
    }
    let mut report = Vec::new();
    for case in cases {
        let name = case["name"].as_str().ok_or("each test needs a name")?;
        let amount = number(&case["amount"])?;
        let native = number(case.get("native_amount").unwrap_or(&case["amount"]))?;
        let native = u64::try_from(native).map_err(|_| "native test amount exceeds u64")?;
        let state = case["state"].as_array().ok_or("state must be an array")?;
        let expected = case["next"].as_array().ok_or("next must be an array")?;
        if ![fields.len(), 4].contains(&state.len()) || expected.len() != state.len() {
            return Err(format!(
                "{name}: state/next must match schema or four padded slots"
            ));
        }
        let mut old = [0u128; 4];
        let mut next = [0u128; 4];
        for (index, value) in state.iter().enumerate() {
            old[index] = number(value)?;
        }
        for (index, value) in expected.iter().enumerate() {
            next[index] = number(value)?;
        }
        let allow = case["allow"].as_bool().ok_or("allow must be boolean")?;
        let opening = PedersenOpening::new_rand();
        let mut commitment = Pedersen::with(native, &opening).to_bytes();
        if let Some(index) = case.get("corrupt_commitment_byte") {
            let index = number(index)? as usize;
            if index >= 32 {
                return Err("commitment byte index must be below32".into());
            }
            commitment[index] ^= 1;
        }
        let mut inputs = FxHashMap::<usize, EvalValue<DefaultConfig>>::default();
        inputs.insert(0, DomainElement::Scalar(scalar(amount)));
        inputs.insert(
            1,
            DomainElement::Scalar(ScalarField::from(*opening.get_scalar())),
        );
        for (index, value) in old.iter().enumerate() {
            inputs.insert(2 + index, DomainElement::Scalar(scalar(*value)));
        }
        for (index, value) in commitment.iter().enumerate() {
            inputs.insert(
                6 + index,
                DomainElement::Scalar(ScalarField::from(*value as u64)),
            );
        }
        let actual: Vec<_> = ir
            .eval(&mut rand::thread_rng(), &mut inputs)
            .map_err(|error| format!("{error:?}"))?
            .into_iter()
            .map(DomainElement::unwrap_scalar)
            .collect();
        let expected: Vec<_> = std::iter::once(ScalarField::from(allow as u64))
            .chain(next.map(scalar))
            .collect();
        if actual != expected {
            return Err(format!(
                "{name}: synthetic host result differs from expected decision/state"
            ));
        }
        report.push(json!({"name":name,"passed":true}));
    }
    Ok(
        json!({"qualification":"synthetic-host-IR-only", "nativeCommitment":"solana-zk-sdk7.0.1", "cases":report,
        "distributedExecution":false,"nativeSettlement":false,"observerPlaintext":true}),
    )
}
