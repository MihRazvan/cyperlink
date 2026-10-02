use super::*;
use arcis_compiler::{
    compile::{compile_and_write_all, write_ir, ArcisCOptions},
    core::{
        expressions::{
            curve_expr::{CurveExpr, InputInfo as CurveInputInfo},
            field_expr::{FieldExpr, InputInfo},
            InputKind,
        },
        global_value::{
            curve_value::CurveValue, global_expr_store::with_local_expr_store_as_global,
        },
        ir_builder::{ExprStore, IRBuilder},
    },
    traits::Reveal,
    utils::{
        crypto::{key::X25519PublicKey, rescue_cipher::RescueCipher},
        field::BaseField,
        zkp::pedersen::{Pedersen, PedersenOpening},
    },
    DefaultConfig,
};
use arcis_interface::{write_interface, CircuitInterface, ScalarKind, Value};
use std::{path::Path, rc::Rc};

fn field_input(builder: &mut IRBuilder<DefaultConfig>, index: usize, kind: InputKind) -> usize {
    builder.push_field(FieldExpr::<ScalarField, usize>::Input(
        index,
        Rc::new(InputInfo::from(kind)),
    ))
}
fn mandatory_commitment(
    amount: Field,
    opening: Field,
    expected: [Field; 32],
) -> (BooleanValue, Vec<Field>) {
    let commitment = Pedersen::with(amount, &PedersenOpening::new(opening));
    let bytes: Vec<Field> = commitment
        .get_point()
        .compress()
        .to_bytes()
        .into_iter()
        .map(Field::from)
        .collect();
    let mut matches = bytes[0].eq(expected[0]);
    for index in 1..32 {
        matches = matches & bytes[index].eq(expected[index]);
    }
    (matches, bytes)
}
fn unsigned(bits: usize) -> Value {
    Value::Scalar {
        size_in_bits: bits,
        kind: ScalarKind::Unsigned,
    }
}
fn ct() -> Value {
    Value::Ciphertext { size_in_bits: 253 }
}
fn states() -> Value {
    Value::Array(vec![ct(); 4])
}

/// Build both pinned Arcium artifacts into the supplied directory. Source paths
/// do not enter either interface. Cargo source is trusted local build code.
pub fn build(fields: &[&str], rule: Rule, out: impl AsRef<Path>) -> Result<(), String> {
    validate_schema(fields)?;
    let out = out.as_ref();
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let out_dir = Some(out.to_str().ok_or("non-UTF8 artifact path")?.to_string());
    let mut init = IRBuilder::<DefaultConfig>::new(true);
    let pk = init.push_curve(CurveExpr::Input(
        0,
        Rc::new(CurveInputInfo::from(InputKind::Plaintext)),
    ));
    let ids: Vec<_> = (1..7)
        .map(|index| field_input(&mut init, index, InputKind::Plaintext))
        .collect();
    let outputs = with_local_expr_store_as_global(
        || {
            let f = |index: usize| Field::from_id(ids[index - 1]);
            let cipher = RescueCipher::<ScalarField, Field>::new_with_client::<
                FieldValue<BaseField>,
                Field,
                CurveValue<DefaultConfig>,
            >(X25519PublicKey::new(CurveValue::new(pk), true));
            let initial = cipher.decrypt((2..6).map(f).collect(), f(1));
            let mut valid = field(0).eq(field(0));
            for (index, value) in initial.iter().enumerate() {
                valid = valid & !value.gt(field(u64::MAX));
                if index >= fields.len() {
                    valid = valid & value.eq(field(0));
                }
            }
            let safe: Vec<_> = initial
                .into_iter()
                .map(|value| valid.select(value, field(0)))
                .collect();
            let encrypted = RescueCipher::<ScalarField, Field>::new_for_mxe().encrypt(safe, f(6));
            std::iter::once(Field::from(valid.reveal()).get_id())
                .chain(encrypted.into_iter().map(|value| value.get_id()))
                .collect()
        },
        &mut init,
    );
    write(
        init,
        outputs,
        "runtime_policy_init",
        vec![
            Value::ArcisX25519Pubkey,
            unsigned(128),
            states(),
            unsigned(128),
        ],
        vec![Value::Bool, states()],
        &out_dir,
    )?;

    let mut evaluate = IRBuilder::<DefaultConfig>::new(true);
    let pk = evaluate.push_curve(CurveExpr::Input(
        0,
        Rc::new(CurveInputInfo::from(InputKind::Plaintext)),
    ));
    let ids: Vec<_> = (1..42)
        .map(|index| field_input(&mut evaluate, index, InputKind::Plaintext))
        .collect();
    let outputs = with_local_expr_store_as_global(
        || {
            let f = |index: usize| Field::from_id(ids[index - 1]);
            let client = RescueCipher::<ScalarField, Field>::new_with_client::<
                FieldValue<BaseField>,
                Field,
                CurveValue<DefaultConfig>,
            >(X25519PublicKey::new(CurveValue::new(pk), true));
            let operation = client.decrypt(vec![f(2), f(3)], f(1));
            let state_cipher = RescueCipher::<ScalarField, Field>::new_for_mxe();
            let old: [Field; 4] = state_cipher
                .decrypt((5..9).map(f).collect(), f(4))
                .try_into()
                .unwrap();
            let (valid, commitment) = mandatory_commitment(
                operation[0],
                operation[1],
                std::array::from_fn(|index| f(10 + index)),
            );
            let (allow, successor) = apply(fields, rule, operation[0], old, valid);
            let encrypted = state_cipher.encrypt(successor.to_vec(), f(9));
            commitment
                .into_iter()
                .map(|byte| byte.reveal().get_id())
                .chain(std::iter::once(Field::from(allow.reveal()).get_id()))
                .chain(encrypted.into_iter().map(|value| value.get_id()))
                .collect()
        },
        &mut evaluate,
    );
    write(
        evaluate,
        outputs,
        "runtime_policy_evaluate",
        vec![
            Value::ArcisX25519Pubkey,
            unsigned(128),
            ct(),
            ct(),
            unsigned(128),
            states(),
            unsigned(128),
            Value::Array(vec![unsigned(8); 32]),
        ],
        vec![Value::Array(vec![unsigned(8); 32]), Value::Bool, states()],
        &out_dir,
    )?;
    Ok(())
}
fn write(
    builder: IRBuilder<DefaultConfig>,
    outputs: Vec<usize>,
    name: &str,
    inputs: Vec<Value>,
    output_types: Vec<Value>,
    out_dir: &Option<String>,
) -> Result<(), String> {
    let path = write_ir(
        builder.into_ir(outputs),
        name,
        &ArcisCOptions {
            out_dir: out_dir.clone(),
        },
    );
    let interface = CircuitInterface::new(name.into(), inputs, output_types);
    let interfaces = write_interface(
        interface.serialize().map_err(|e| e.to_string())?,
        name,
        out_dir,
    )
    .map_err(|e| e.to_string())?;
    compile_and_write_all(
        &[(&path.path, path.hash)],
        &interfaces
            .iter()
            .map(|p| (p.path.as_str(), p.hash))
            .collect::<Vec<_>>(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Host-only IR evaluator entrypoint for customer tests. Secret inputs are
/// amount, full opening scalar, four state fields, then32 public commitment
/// bytes. Outputs expose test decision/state. NEVER deployed as a circuit.
pub fn host_ir(
    fields: &[&str],
    rule: Rule,
) -> arcis_compiler::core::ir::IntermediateRepresentation<DefaultConfig> {
    validate_schema(fields).unwrap();
    let mut builder = IRBuilder::<DefaultConfig>::new(true);
    let ids: Vec<_> = (0..38)
        .map(|index| {
            field_input(
                &mut builder,
                index,
                if index < 6 {
                    InputKind::Secret
                } else {
                    InputKind::Plaintext
                },
            )
        })
        .collect();
    let outputs = with_local_expr_store_as_global(
        || {
            let f = |index: usize| Field::from_id(ids[index]);
            let (valid, _) =
                mandatory_commitment(f(0), f(1), std::array::from_fn(|index| f(6 + index)));
            let (allow, successor) = apply(
                fields,
                rule,
                f(0),
                std::array::from_fn(|index| f(2 + index)),
                valid,
            );
            std::iter::once(Field::from(allow).get_id())
                .chain(successor.into_iter().map(|value| value.get_id()))
                .collect()
        },
        &mut builder,
    );
    builder.into_ir(outputs)
}
