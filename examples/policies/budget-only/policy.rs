use cyperlink_policy_authoring::{Context, Payment, State, Decision};
pub const FIELDS: &[&str] = &["remaining"];
pub fn policy(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let amount = payment.amount();
    let remaining = state.get("remaining");
    let allowed = amount.gt(ctx.constant(0)).and(amount.le(remaining));
    let next = ctx.sub(remaining, amount);
    ctx.finish(allowed, &[next])
}
