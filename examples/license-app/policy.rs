use cyperlink_policy_authoring::{Context, Decision, Payment, State};

pub const FIELDS: &[&str] = &["remaining", "purchase_cap"];

// Both values are confidential initialization fields; there is no public cap.
pub fn policy(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let amount = payment.amount();
    let remaining = state.get("remaining");
    let cap = state.get("purchase_cap");
    let allow = amount.gt(ctx.constant(0))
        .and(amount.le(cap))
        .and(amount.le(remaining));
    let successor = ctx.sub(remaining, amount);
    ctx.finish(allow, &[successor, cap])
}
