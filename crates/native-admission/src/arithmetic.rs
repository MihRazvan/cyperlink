// Vendored upstream SPL ciphertext arithmetic 0.5.1; see UPSTREAM.md.

use {
    bytemuck::bytes_of,
    solana_curve25519::{
        ristretto::{add_ristretto, multiply_ristretto, subtract_ristretto, PodRistrettoPoint},
        scalar::PodScalar,
    },
    solana_zk_sdk_pod::encryption::elgamal::{PodElGamalCiphertext, PodElGamalPubkey},
};

const SHIFT_BITS: usize = 16;

/// `G` is the Ristretto base point used to encode the amount in a Pedersen
/// commitment. A Pedersen commitment to an `amount` with randomness `r` is computed
/// as `amount * G + r * H`.
const G: PodRistrettoPoint = PodRistrettoPoint([
    226, 242, 174, 10, 106, 188, 78, 113, 168, 132, 169, 97, 197, 0, 81, 95, 88, 227, 11, 106, 165,
    130, 221, 141, 182, 166, 89, 69, 224, 141, 45, 118,
]);

/// `H` is the Ristretto base point used to encode the randomness (opening) in
/// a Pedersen commitment. It is also used as the base point for Twisted ElGamal
/// public keys. Because `H` is a valid curve point, adding `1 * H` to a ciphertext
/// ensures the resulting commitment is not the identity point (all zeros).
const H: PodRistrettoPoint = PodRistrettoPoint([
    140, 146, 64, 180, 86, 169, 230, 220, 101, 195, 119, 161, 4, 141, 116, 95, 148, 160, 140, 219,
    127, 68, 203, 205, 123, 70, 243, 64, 72, 135, 17, 52,
]);

/// Add two ElGamal ciphertexts
pub fn add(
    left_ciphertext: &PodElGamalCiphertext,
    right_ciphertext: &PodElGamalCiphertext,
) -> Option<PodElGamalCiphertext> {
    let (left_commitment, left_handle) = elgamal_ciphertext_to_ristretto(left_ciphertext);
    let (right_commitment, right_handle) = elgamal_ciphertext_to_ristretto(right_ciphertext);

    let result_commitment = add_ristretto(&left_commitment, &right_commitment)?;
    let result_handle = add_ristretto(&left_handle, &right_handle)?;

    Some(ristretto_to_elgamal_ciphertext(
        &result_commitment,
        &result_handle,
    ))
}

/// Multiply an ElGamal ciphertext by a scalar
pub fn multiply(
    scalar: &PodScalar,
    ciphertext: &PodElGamalCiphertext,
) -> Option<PodElGamalCiphertext> {
    let (commitment, handle) = elgamal_ciphertext_to_ristretto(ciphertext);

    let result_commitment = multiply_ristretto(scalar, &commitment)?;
    let result_handle = multiply_ristretto(scalar, &handle)?;

    Some(ristretto_to_elgamal_ciphertext(
        &result_commitment,
        &result_handle,
    ))
}

/// Compute `left_ciphertext + (right_ciphertext_lo + 2^16 *
/// right_ciphertext_hi)`
pub fn add_with_lo_hi(
    left_ciphertext: &PodElGamalCiphertext,
    right_ciphertext_lo: &PodElGamalCiphertext,
    right_ciphertext_hi: &PodElGamalCiphertext,
) -> Option<PodElGamalCiphertext> {
    let (left_commitment, left_handle) = elgamal_ciphertext_to_ristretto(left_ciphertext);
    let (lo_commitment, lo_handle) = elgamal_ciphertext_to_ristretto(right_ciphertext_lo);
    let (hi_commitment, hi_handle) = elgamal_ciphertext_to_ristretto(right_ciphertext_hi);

    let shift_scalar = u64_to_scalar(1_u64 << SHIFT_BITS);

    let hi_commitment_shifted = multiply_ristretto(&shift_scalar, &hi_commitment)?;
    let right_commitment_combined = add_ristretto(&lo_commitment, &hi_commitment_shifted)?;

    let hi_handle_shifted = multiply_ristretto(&shift_scalar, &hi_handle)?;
    let right_handle_combined = add_ristretto(&lo_handle, &hi_handle_shifted)?;

    let final_commitment = add_ristretto(&left_commitment, &right_commitment_combined)?;
    let final_handle = add_ristretto(&left_handle, &right_handle_combined)?;

    Some(ristretto_to_elgamal_ciphertext(
        &final_commitment,
        &final_handle,
    ))
}

/// Subtract two ElGamal ciphertexts
pub fn subtract(
    left_ciphertext: &PodElGamalCiphertext,
    right_ciphertext: &PodElGamalCiphertext,
) -> Option<PodElGamalCiphertext> {
    let (left_commitment, left_handle) = elgamal_ciphertext_to_ristretto(left_ciphertext);
    let (right_commitment, right_handle) = elgamal_ciphertext_to_ristretto(right_ciphertext);

    let result_commitment = subtract_ristretto(&left_commitment, &right_commitment)?;
    let result_handle = subtract_ristretto(&left_handle, &right_handle)?;

    Some(ristretto_to_elgamal_ciphertext(
        &result_commitment,
        &result_handle,
    ))
}

/// Compute `left_ciphertext - (right_ciphertext_lo + 2^16 *
/// right_ciphertext_hi)`
pub fn subtract_with_lo_hi(
    left_ciphertext: &PodElGamalCiphertext,
    right_ciphertext_lo: &PodElGamalCiphertext,
    right_ciphertext_hi: &PodElGamalCiphertext,
) -> Option<PodElGamalCiphertext> {
    let (left_commitment, left_handle) = elgamal_ciphertext_to_ristretto(left_ciphertext);
    let (lo_commitment, lo_handle) = elgamal_ciphertext_to_ristretto(right_ciphertext_lo);
    let (hi_commitment, hi_handle) = elgamal_ciphertext_to_ristretto(right_ciphertext_hi);

    let shift_scalar = u64_to_scalar(1_u64 << SHIFT_BITS);

    let hi_commitment_shifted = multiply_ristretto(&shift_scalar, &hi_commitment)?;
    let right_commitment_combined = add_ristretto(&lo_commitment, &hi_commitment_shifted)?;

    let hi_handle_shifted = multiply_ristretto(&shift_scalar, &hi_handle)?;
    let right_handle_combined = add_ristretto(&lo_handle, &hi_handle_shifted)?;

    let final_commitment = subtract_ristretto(&left_commitment, &right_commitment_combined)?;
    let final_handle = subtract_ristretto(&left_handle, &right_handle_combined)?;

    Some(ristretto_to_elgamal_ciphertext(
        &final_commitment,
        &final_handle,
    ))
}

/// Add a constant amount to a ciphertext
pub fn add_to(ciphertext: &PodElGamalCiphertext, amount: u64) -> Option<PodElGamalCiphertext> {
    let amount_scalar = u64_to_scalar(amount);
    let amount_point = multiply_ristretto(&amount_scalar, &G)?;

    let (commitment, handle) = elgamal_ciphertext_to_ristretto(ciphertext);

    let result_commitment = add_ristretto(&commitment, &amount_point)?;

    Some(ristretto_to_elgamal_ciphertext(&result_commitment, &handle))
}

/// Add a constant amount to a ciphertext with a fixed offset
pub fn add_to_with_offset(
    pubkey: &PodElGamalPubkey,
    ciphertext: &PodElGamalCiphertext,
    amount: u64,
) -> Option<PodElGamalCiphertext> {
    let amount_scalar = u64_to_scalar(amount);
    let amount_point = multiply_ristretto(&amount_scalar, &G)?;
    let amount_point_with_offset = add_ristretto(&amount_point, &H)?;
    let pubkey_point = elgamal_pubkey_to_ristretto(pubkey);

    let (commitment, handle) = elgamal_ciphertext_to_ristretto(ciphertext);

    let result_commitment = add_ristretto(&commitment, &amount_point_with_offset)?;
    let result_handle = add_ristretto(&handle, &pubkey_point)?;

    Some(ristretto_to_elgamal_ciphertext(
        &result_commitment,
        &result_handle,
    ))
}

/// Subtract a constant amount to a ciphertext
pub fn subtract_from(
    ciphertext: &PodElGamalCiphertext,
    amount: u64,
) -> Option<PodElGamalCiphertext> {
    let amount_scalar = u64_to_scalar(amount);
    let amount_point = multiply_ristretto(&amount_scalar, &G)?;

    let (commitment, handle) = elgamal_ciphertext_to_ristretto(ciphertext);

    let result_commitment = subtract_ristretto(&commitment, &amount_point)?;

    Some(ristretto_to_elgamal_ciphertext(&result_commitment, &handle))
}

/// Convert a `u64` amount into a curve-25519 scalar
fn u64_to_scalar(amount: u64) -> PodScalar {
    let mut amount_bytes = [0u8; 32];
    amount_bytes[..8].copy_from_slice(&amount.to_le_bytes());
    PodScalar(amount_bytes)
}

/// Convert a `PodElGamalPubkey` into `PodRistrettoPoint`
fn elgamal_pubkey_to_ristretto(pubkey: &PodElGamalPubkey) -> PodRistrettoPoint {
    let bytes = bytes_of(pubkey);
    PodRistrettoPoint(bytes.try_into().unwrap())
}

/// Convert a `PodElGamalCiphertext` into a tuple of commitment and decrypt
/// handle `PodRistrettoPoint`
fn elgamal_ciphertext_to_ristretto(
    ciphertext: &PodElGamalCiphertext,
) -> (PodRistrettoPoint, PodRistrettoPoint) {
    let ciphertext_bytes = bytes_of(ciphertext); // must be of length 64 by type
    let commitment_bytes = ciphertext_bytes[..32].try_into().unwrap();
    let handle_bytes = ciphertext_bytes[32..64].try_into().unwrap();
    (
        PodRistrettoPoint(commitment_bytes),
        PodRistrettoPoint(handle_bytes),
    )
}

/// Convert a pair of `PodRistrettoPoint` to a `PodElGamalCiphertext`
/// interpreting the first as the commitment and the second as the handle
fn ristretto_to_elgamal_ciphertext(
    commitment: &PodRistrettoPoint,
    handle: &PodRistrettoPoint,
) -> PodElGamalCiphertext {
    let mut ciphertext_bytes = [0u8; 64];
    ciphertext_bytes[..32].copy_from_slice(bytes_of(commitment));
    ciphertext_bytes[32..64].copy_from_slice(bytes_of(handle));

    PodElGamalCiphertext::from(ciphertext_bytes)
}
