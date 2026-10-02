use cyperlink_policy_authoring::{Context, Decision, Payment, State};

pub const FIELDS: &[&str] = &["remaining", "reserve"];

// Both fields are private initialization parameters. The reserve is not source code.
pub fn policy(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let remaining = state.get("remaining");
    let reserve = state.get("reserve");
    let amount = payment.amount();
    // Checked subtraction contributes to wrapper validity even when approval is false.
    let after = ctx.sub(remaining, amount);
    let allowed = amount.gt(ctx.constant(0)).and(after.ge(reserve));
    ctx.finish(allowed, &[after, reserve])
}
