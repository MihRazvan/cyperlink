use cyperlink_policy_authoring::{
    test_vectors_json, validate_schema, Context, Decision, Payment, State,
};
use serde_json::json;
fn count(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let amount = payment.amount();
    let remaining = state.get("remaining");
    let count = state.get("count");
    let allow = amount
        .gt(ctx.constant(0))
        .and(amount.le(remaining))
        .and(count.lt(ctx.constant(5)));
    let next = ctx.sub(remaining, amount);
    let count = ctx.add(count, ctx.constant(1));
    ctx.finish(allow, &[next, count])
}
fn novel(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let units = state.get("units");
    let reward = state.get("reward");
    let double = ctx.mul(payment.amount(), ctx.constant(2));
    let next = ctx.sub(units, double);
    let new_reward = ctx.add(reward, ctx.constant(3));
    let next_reward = payment
        .amount()
        .ge(ctx.constant(10))
        .select(new_reward, reward);
    ctx.finish(payment.amount().gt(ctx.constant(0)), &[next, next_reward])
}
#[test]
fn mandatory_binding_ranges_count_and_all_commitment_bytes() {
    let mut vectors = vec![
        json!({"name":"fifth","amount":40,"state":[100,4],"allow":true,"next":[60,5]}),
        json!({"name":"exhausted","amount":1,"state":[60,5],"allow":false,"next":[60,5]}),
        json!({"name":"overspend-underflow","amount":101,"state":[100,0],"allow":false,"next":[100,0]}),
        json!({"name":"zero","amount":0,"state":[100,0],"allow":false,"next":[100,0]}),
        json!({"name":"unboundamount","amount":39,"native_amount":40,"state":[100,0],"allow":false,"next":[100,0]}),
        json!({"name":"amount48","amount":"281474976710656","state":["18446744073709551615",0],"allow":false,"next":["18446744073709551615",0]}),
        json!({"name":"state64","amount":1,"state":["18446744073709551616",0],"allow":false,"next":["18446744073709551616",0]}),
        json!({"name":"countoverflow","amount":1,"state":[100,"18446744073709551615"],"allow":false,"next":[100,"18446744073709551615"]}),
        json!({"name":"padding","amount":1,"state":[100,0,0,1],"allow":false,"next":[100,0,0,1]}),
    ];
    for index in 0..32 {
        vectors.push(json!({"name":format!("commitment-byte-{index}"),"amount":40,"state":[100,0],"allow":false,"next":[100,0],"corrupt_commitment_byte":index}));
    }
    test_vectors_json(&["remaining", "count"], count, &json!(vectors)).unwrap();
}
#[test]
fn novel_composition_and_unselected_overflow_fail_closed() {
    test_vectors_json(&["units","reward"], novel, &json!([
        {"name":"reward","amount":10,"state":[100,7],"allow":true,"next":[80,10]},
        {"name":"small","amount":3,"state":[100,7],"allow":true,"next":[94,7]},
        {"name":"unselected-add-overflow","amount":3,"state":[100,"18446744073709551615"],"allow":false,"next":[100,"18446744073709551615"]},
        {"name":"subtract-underflow","amount":30,"state":[40,7],"allow":false,"next":[40,7]}
    ])).unwrap();
}
#[test]
fn malformed_state_schema_rejected() {
    for fields in [
        vec![],
        vec!["a", "a"],
        vec!["a", "b", "c", "d", "e"],
        vec!["Amount"],
        vec!["a-b"],
    ] {
        assert!(validate_schema(&fields).is_err());
    }
    assert!(validate_schema(&["a", "b", "c", "d"]).is_ok());
}

#[test]
fn multiplication_overflow_is_not_field_wrap() {
    fn multiply(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
        let value = ctx.mul(state.get("value"), payment.amount());
        ctx.finish(ctx.yes(), &[value])
    }
    test_vectors_json(&["value"], multiply, &json!([
        {"name":"valid-boundary","amount":1,"state":["18446744073709551615"],"allow":true,"next":["18446744073709551615"]},
        {"name":"overflow","amount":2,"state":["18446744073709551615"],"allow":false,"next":["18446744073709551615"]}
    ])).unwrap();
}

#[test]
#[ignore = "explicit comparison of independently built artifacts"]
fn compile_artifact_variants() {
    let base = std::path::PathBuf::from(std::env::var("CYPERLINK_POLICY_BUILD_OUT").unwrap());
    let repeat = base.join("repeat");
    let changed = base.join("changed");
    cyperlink_policy_authoring::build(&["remaining", "count"], count, &repeat).unwrap();
    cyperlink_policy_authoring::build(&["units", "reward"], novel, &changed).unwrap();
    for name in ["runtime_policy_init", "runtime_policy_evaluate"] {
        for extension in ["arcis", "hash", "idarc", "weight"] {
            let filename = format!("{name}.{extension}");
            assert_eq!(
                std::fs::read(base.join(&filename)).unwrap(),
                std::fs::read(repeat.join(&filename)).unwrap(),
                "artifact must be independent of absolute output path: {filename}"
            );
        }
    }
    assert_ne!(
        std::fs::read(base.join("runtime_policy_evaluate.arcis")).unwrap(),
        std::fs::read(changed.join("runtime_policy_evaluate.arcis")).unwrap()
    );
}
#[test]
#[ignore = "explicit artifact generation writes to CYPERLINK_POLICY_BUILD_OUT"]
fn compile_artifacts() {
    cyperlink_policy_authoring::build(
        &["remaining", "count"],
        count,
        std::env::var("CYPERLINK_POLICY_BUILD_OUT").expect("set private build output directory"),
    )
    .unwrap();
}
