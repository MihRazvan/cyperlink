//! Typed, fixed-shape private policies. Customer expressions are compiled into
//! Arcium ScalarField MPC; no policy is evaluated by a production plaintext service.
mod compile;
mod testing;
use arcis_compiler::{
    core::{circuits::boolean::boolean_value::BooleanValue, global_value::value::FieldValue},
    traits::{Equal, GreaterThan, Select},
    utils::field::ScalarField,
};
pub use compile::{build, host_ir};
pub use testing::{test_vectors, test_vectors_json};

pub const STATE_SLOTS: usize = 4;
type Field = FieldValue<ScalarField>;
fn field(value: u64) -> Field {
    Field::from(ScalarField::from(value))
}

/// A private unsigned 64-bit expression. Its representation is intentionally opaque.
#[derive(Clone, Copy)]
pub struct U64(Field);
/// A private Boolean expression. It cannot be inspected using Rust `if`.
#[derive(Clone, Copy)]
pub struct Bool(BooleanValue);
impl U64 {
    pub fn eq(self, rhs: Self) -> Bool {
        Bool(self.0.eq(rhs.0))
    }
    pub fn gt(self, rhs: Self) -> Bool {
        Bool(self.0.gt(rhs.0))
    }
    pub fn ge(self, rhs: Self) -> Bool {
        Bool(!rhs.0.gt(self.0))
    }
    pub fn lt(self, rhs: Self) -> Bool {
        rhs.gt(self)
    }
    pub fn le(self, rhs: Self) -> Bool {
        rhs.ge(self)
    }
}
impl Bool {
    pub fn and(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
    pub fn or(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
    pub fn not(self) -> Self {
        Self(!self.0)
    }
    pub fn select(self, yes: U64, no: U64) -> U64 {
        U64(self.0.select(yes.0, no.0))
    }
}
#[derive(Clone, Copy)]
pub struct Payment {
    amount: U64,
}
impl Payment {
    pub fn amount(self) -> U64 {
        self.amount
    }
}
pub struct State {
    values: [U64; STATE_SLOTS],
    fields: Vec<String>,
}
impl State {
    pub fn get(&self, name: &str) -> U64 {
        self.values[self
            .fields
            .iter()
            .position(|field| field == name)
            .unwrap_or_else(|| panic!("undeclared private state field: {name}"))]
    }
}
pub struct Decision {
    allow: Bool,
    successor: Vec<U64>,
}
pub struct Context {
    valid: BooleanValue,
}
impl Context {
    pub fn constant(&self, value: u64) -> U64 {
        U64(field(value))
    }
    pub fn yes(&self) -> Bool {
        Bool(field(0).eq(field(0)))
    }
    /// All checked expressions must be valid, even in an unselected branch.
    pub fn add(&mut self, lhs: U64, rhs: U64) -> U64 {
        let result = lhs.0 + rhs.0;
        self.valid = self.valid & !result.gt(field(u64::MAX));
        U64(result)
    }
    pub fn sub(&mut self, lhs: U64, rhs: U64) -> U64 {
        self.valid = self.valid & !rhs.0.gt(lhs.0);
        U64(lhs.0 - rhs.0)
    }
    pub fn mul(&mut self, lhs: U64, rhs: U64) -> U64 {
        // Each operand is guarded u64; their product is below 2^128, well
        // below ScalarField modulus. No field wrap can hide u64 overflow.
        let result = lhs.0 * rhs.0;
        self.valid = self.valid & !result.gt(field(u64::MAX));
        U64(result)
    }
    pub fn finish(&self, allow: Bool, successor: &[U64]) -> Decision {
        Decision {
            allow,
            successor: successor.to_vec(),
        }
    }
}
/// Function pointers deliberately exclude a runtime plaintext policy backend.
pub type Rule = fn(&mut Context, Payment, &State) -> Decision;

pub fn validate_schema(fields: &[&str]) -> Result<(), String> {
    if fields.is_empty() || fields.len() > STATE_SLOTS {
        return Err("declare between one and four private u64 state fields".into());
    }
    for (index, name) in fields.iter().enumerate() {
        if name.is_empty()
            || name.len() > 48
            || !name.as_bytes()[0].is_ascii_lowercase()
            || !name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            return Err(format!("invalid private field name: {name}"));
        }
        if fields[..index].contains(name) {
            return Err(format!("duplicate private field: {name}"));
        }
    }
    Ok(())
}

fn apply(
    fields: &[&str],
    rule: Rule,
    amount: Field,
    old: [Field; 4],
    native_valid: BooleanValue,
) -> (BooleanValue, [Field; 4]) {
    let mut valid = native_valid & !amount.gt(field((1u64 << 48) - 1));
    for (index, value) in old.iter().enumerate() {
        valid = valid & !value.gt(field(u64::MAX));
        if index >= fields.len() {
            valid = valid & value.eq(field(0));
        }
    }
    let mut context = Context { valid };
    let decision = rule(
        &mut context,
        Payment {
            amount: U64(amount),
        },
        &State {
            values: old.map(U64),
            fields: fields.iter().map(|s| s.to_string()).collect(),
        },
    );
    assert_eq!(
        decision.successor.len(),
        fields.len(),
        "successor must have exactly the declared state shape"
    );
    let mut next = [field(0); 4];
    for (index, value) in decision.successor.iter().enumerate() {
        context.valid = context.valid & !value.0.gt(field(u64::MAX));
        next[index] = value.0;
    }
    let allow = context.valid & decision.allow.0;
    (
        allow,
        std::array::from_fn(|index| allow.select(next[index], old[index])),
    )
}
