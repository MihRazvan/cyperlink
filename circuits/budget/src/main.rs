//! Host compilation only. No distributed execution or caller-provided secret key inputs.
use arcis_compiler::{
    core::{
        expressions::{field_expr::{FieldExpr, InputInfo}, curve_expr::{CurveExpr, InputInfo as CurveInputInfo}, InputKind},
        global_value::{curve_value::CurveValue, value::FieldValue, global_expr_store::with_local_expr_store_as_global},
        ir_builder::{IRBuilder, ExprStore},
    },
    traits::{Reveal, GreaterThan, Select, Equal},
    utils::{field::{BaseField, ScalarField}, crypto::{key::X25519PublicKey, rescue_cipher::RescueCipher}, zkp::pedersen::{Pedersen, PedersenOpening}},
    compile::{write_ir, ArcisCOptions, compile_and_write_all},
    ArcisInstruction, DefaultConfig,
};
use arcis_interface::{CircuitInterface, Value, ScalarKind, write_interface};
use std::{rc::Rc, time::Instant};

fn main() {
    std::env::set_current_dir(env!("CARGO_MANIFEST_DIR")).unwrap();
    let mut builder = IRBuilder::<DefaultConfig>::new(true);
    let client_pk = builder.push_curve(CurveExpr::Input(0, Rc::new(CurveInputInfo::from(InputKind::Plaintext))));
    // 1 client nonce; 2 amount CT; 3 opening CT; 4 quota nonce; 5 quota CT; 6 successor nonce.
    // 7..38: public, queue-authenticated expected native commitment bytes.
    // All are public ENCRYPTED transport or public metadata. None is a caller-provided key.
    let fields: Vec<_> = (1..39).map(|i| builder.push_field(FieldExpr::<ScalarField, usize>::Input(i, Rc::new(InputInfo::from(InputKind::Plaintext))))).collect();
    let outputs = with_local_expr_store_as_global(|| {
        let f = |i: usize| FieldValue::<ScalarField>::from_id(fields[i-1]);
        let client_cipher = RescueCipher::<ScalarField, FieldValue<ScalarField>>::new_with_client::<FieldValue<BaseField>, FieldValue<ScalarField>, CurveValue<DefaultConfig>>(
            X25519PublicKey::new(CurveValue::new(client_pk), true)
        );
        let decrypted = client_cipher.decrypt(vec![f(2), f(3)], f(1));
        let amount = decrypted[0];
        let opening = decrypted[1];
        let quota_cipher = RescueCipher::<ScalarField, FieldValue<ScalarField>>::new_for_mxe();
        let old = quota_cipher.decrypt(vec![f(5)], f(4))[0];
        let valid_amount = !amount.gt(FieldValue::<ScalarField>::from(ScalarField::from((1u64 << 48) - 1)));
        let valid_old = !old.gt(FieldValue::<ScalarField>::from(ScalarField::from(u64::MAX)));
        let commitment = Pedersen::with(amount, &PedersenOpening::new(opening));
        let commitment_bytes = commitment.get_point().compress().to_bytes();
        let mut matches = FieldValue::<ScalarField>::from(commitment_bytes[0]).eq(f(7));
        for i in 1..32 { matches = matches & FieldValue::<ScalarField>::from(commitment_bytes[i]).eq(f(7+i)); }
        let allow = matches & valid_amount & valid_old & !amount.gt(old);
        let next = allow.select(old - amount, old);
        let next_ciphertext = quota_cipher.encrypt(vec![next], f(6))[0];
        // Deliberately public outputs: canonical commitment, decision, encrypted successor.
        let mut result = commitment.get_point().compress().to_bytes().into_iter()
            .map(|byte| FieldValue::<ScalarField>::from(byte).reveal().get_id()).collect::<Vec<_>>();
        result.push(FieldValue::<ScalarField>::from(allow.reveal()).get_id());
        result.push(next_ciphertext.get_id());
        result
    }, &mut builder);
    let ir = builder.into_ir(outputs);
    let out_dir = Some("build".to_string());
    let name = "runtime_budget_bound";
    let path = write_ir(ir, name, &ArcisCOptions { out_dir: out_dir.clone() });
    let unsigned = |bits| Value::Scalar { size_in_bits: bits, kind: ScalarKind::Unsigned };
    let ciphertext = || Value::Ciphertext { size_in_bits: 253 };
    let interface = CircuitInterface::new(name.to_owned(), vec![
        Value::ArcisX25519Pubkey, unsigned(128), ciphertext(), ciphertext(),
        unsigned(128), ciphertext(), unsigned(128),
        Value::Array(vec![unsigned(8);32]),
    ], vec![Value::Array(vec![unsigned(8); 32]), Value::Bool, ciphertext()]);
    assert_eq!(interface.inputs.iter().map(Value::size_in_scalars).sum::<usize>(), 39);
    assert_eq!(interface.outputs.iter().map(Value::size_in_scalars).sum::<usize>(), 34);
    let interfaces = write_interface(interface.serialize().unwrap(), name, &out_dir).unwrap();
    let started = Instant::now();
    compile_and_write_all(&[(&path.path, path.hash)], &interfaces.iter().map(|p| (p.path.as_str(),p.hash)).collect::<Vec<_>>()).unwrap();
    let bytes = std::fs::read(format!("build/{name}.arcis")).unwrap();
    let instruction = ArcisInstruction::<DefaultConfig>::from_current_bytes(bytes).unwrap();
    std::fs::write("build/runtime-metadata.json", serde_json::to_vec_pretty(&instruction.metadata).unwrap()).unwrap();
    println!("host_compile_ms={} public_interface_inputs=39 flattened_outputs=34", started.elapsed().as_millis());
    println!("runtime_metadata={:#?}", instruction.metadata);

}
