use cyperlink_policy_authoring::{Context, Payment, State, Decision};
pub const FIELDS: &[&str] = &["remaining", "purchases"];
pub fn policy(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let amount = payment.amount();
    let remaining = state.get("remaining");
    let count = state.get("purchases");
    let allow = amount.gt(ctx.constant(0)).and(amount.le(remaining)).and(count.lt(ctx.constant(5)));
    let next_remaining = ctx.sub(remaining, amount);
    let next_count = ctx.add(count, ctx.constant(1));
    ctx.finish(allow, &[next_remaining, next_count])
}
