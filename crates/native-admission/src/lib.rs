//! Read-only admission for the strict no-fee, preverified-context profile.
//! This validates present native executability, not reservation or query privacy.
//! The caller must authenticate the owner signature and supply actual account
//! owners/data, bind the exact action and snapshots, and enforce consumer policy.

#[allow(dead_code)]
mod arithmetic;

use bytemuck::Pod;
use solana_curve25519::{
    ristretto::{add_ristretto, multiply_ristretto, PodRistrettoPoint},
    scalar::PodScalar,
};
use solana_zk_elgamal_proof_interface::{
    proof_data::{
        BatchedGroupedCiphertext3HandlesValidityProofContext, BatchedRangeProofContext,
        CiphertextCommitmentEqualityProofContext, ProofType,
    },
    state::ProofContextState,
};
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::{
            instruction::{ConfidentialTransferInstruction, TransferInstructionData},
            ConfidentialTransferAccount, ConfidentialTransferMint,
        },
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    instruction::{decode_instruction_data, decode_instruction_type, TokenInstruction},
    state::{Account, AccountState, Mint},
};
use spl_token_confidential_transfer_proof_extraction::transfer::TransferProofContext;

#[derive(Clone, Copy)]
pub struct AccountView<'a> {
    pub key: &'a [u8; 32],
    pub owner: &'a [u8; 32],
    pub data: &'a [u8],
}

pub struct NoFeeAction<'a> {
    pub source: AccountView<'a>,
    pub mint: AccountView<'a>,
    pub destination: AccountView<'a>,
    pub equality: AccountView<'a>,
    pub grouped: AccountView<'a>,
    pub range: AccountView<'a>,
    pub owner: &'a [u8; 32],
    pub owner_signed: bool,
    pub owner_account_owner: &'a [u8; 32],
    pub owner_account_data_len: usize,
    pub native_instruction: &'a [u8],
    pub expected_hook: &'a [u8; 32],
    pub expected_commitment: &'a [u8; 32],
    pub expected_new_source_ciphertext: &'a [u8; 64],
}

#[derive(Debug, PartialEq, Eq)]
pub struct ValidatedAction {
    pub amount_commitment: [u8; 32],
    pub new_source_ciphertext: [u8; 64],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionError {
    Owner,
    Account,
    UnsupportedProfile,
    Instruction,
    ProofOwner,
    ProofShape,
    ProofType,
    ProofRelationship,
    EncryptionKey,
    Funding,
    Auditor,
    Commitment,
    Successor,
    Destination,
}

fn context<T: Pod + Copy>(a: AccountView<'_>, kind: ProofType) -> Result<T, AdmissionError> {
    if a.owner.as_slice() != solana_zk_elgamal_proof_interface::id().as_ref() {
        return Err(AdmissionError::ProofOwner);
    }
    let c = bytemuck::try_from_bytes::<ProofContextState<T>>(a.data)
        .map_err(|_| AdmissionError::ProofShape)?;
    if c.proof_type != kind.into() {
        return Err(AdmissionError::ProofType);
    }
    Ok(c.proof_context)
}

fn extensions(actual: Vec<ExtensionType>, allowed: &[ExtensionType]) -> Result<(), AdmissionError> {
    for (i, kind) in actual.iter().enumerate() {
        if !allowed.contains(kind) || actual[..i].contains(kind) {
            return Err(AdmissionError::UnsupportedProfile);
        }
    }
    Ok(())
}

pub fn validate(a: &NoFeeAction<'_>) -> Result<ValidatedAction, AdmissionError> {
    // Only the exact three-context no-fee Transfer instruction is supported.
    let d = a.native_instruction;
    if d.len() != 2 + core::mem::size_of::<TransferInstructionData>()
        || d[0] != TokenInstruction::ConfidentialTransferExtension.pack()[0]
        || !matches!(
            decode_instruction_type::<ConfidentialTransferInstruction>(&d[1..])
                .map_err(|_| AdmissionError::Instruction)?,
            ConfidentialTransferInstruction::Transfer
        )
    {
        return Err(AdmissionError::Instruction);
    }
    let instruction = decode_instruction_data::<TransferInstructionData>(&d[1..])
        .map_err(|_| AdmissionError::Instruction)?;
    if instruction.equality_proof_instruction_offset != 0
        || instruction.ciphertext_validity_proof_instruction_offset != 0
        || instruction.range_proof_instruction_offset != 0
    {
        return Err(AdmissionError::Instruction);
    }
    for account in [a.source, a.mint, a.destination] {
        if account.owner.as_slice() != spl_token_2022_interface::id().as_ref() {
            return Err(AdmissionError::Owner);
        }
    }
    let keys = [
        a.source.key,
        a.mint.key,
        a.destination.key,
        a.equality.key,
        a.grouped.key,
        a.range.key,
    ];
    if keys.iter().enumerate().any(|(i, k)| keys[..i].contains(k)) {
        return Err(AdmissionError::Account);
    }
    let mint =
        StateWithExtensions::<Mint>::unpack(a.mint.data).map_err(|_| AdmissionError::Account)?;
    let source = StateWithExtensions::<Account>::unpack(a.source.data)
        .map_err(|_| AdmissionError::Account)?;
    let destination = StateWithExtensions::<Account>::unpack(a.destination.data)
        .map_err(|_| AdmissionError::Account)?;
    extensions(
        mint.get_extension_types()
            .map_err(|_| AdmissionError::Account)?,
        &[
            ExtensionType::ConfidentialTransferMint,
            ExtensionType::TransferHook,
        ],
    )?;
    for account in [&source, &destination] {
        extensions(
            account
                .get_extension_types()
                .map_err(|_| AdmissionError::Account)?,
            &[
                ExtensionType::ConfidentialTransferAccount,
                ExtensionType::TransferHookAccount,
                ExtensionType::ImmutableOwner,
            ],
        )?;
        if account.base.state != AccountState::Initialized
            || account.base.mint.as_ref() != a.mint.key
            || account.base.is_native.is_some()
            || account.base.delegate.is_some()
        {
            return Err(AdmissionError::Account);
        }
        if bool::from(
            account
                .get_extension::<TransferHookAccount>()
                .map_err(|_| AdmissionError::UnsupportedProfile)?
                .transferring,
        ) {
            return Err(AdmissionError::Account);
        }
    }
    // The native processor treats a token-owned multisig authority specially,
    // even if its AccountInfo signer flag is set. Support normal system wallets
    // only, so signature scaffolding cannot bypass a native authority failure.
    if !a.owner_signed
        || a.owner_account_owner != &[0; 32]
        || a.owner_account_data_len != 0
        || source.base.owner.as_ref() != a.owner
    {
        return Err(AdmissionError::Owner);
    }
    let hook = mint
        .get_extension::<TransferHook>()
        .map_err(|_| AdmissionError::UnsupportedProfile)?;
    let hook_id: Option<solana_address::Address> = hook.program_id.into();
    if hook_id.as_ref().map(|k| k.as_ref()) != Some(a.expected_hook.as_slice())
        || a.expected_hook == &[0; 32]
    {
        return Err(AdmissionError::UnsupportedProfile);
    }
    let mint_ct = mint
        .get_extension::<ConfidentialTransferMint>()
        .map_err(|_| AdmissionError::UnsupportedProfile)?;
    let src = source
        .get_extension::<ConfidentialTransferAccount>()
        .map_err(|_| AdmissionError::Account)?;
    let dst = destination
        .get_extension::<ConfidentialTransferAccount>()
        .map_err(|_| AdmissionError::Account)?;
    src.valid_as_source().map_err(|_| AdmissionError::Account)?;
    dst.valid_as_destination()
        .map_err(|_| AdmissionError::Destination)?;
    let equality: CiphertextCommitmentEqualityProofContext =
        context(a.equality, ProofType::CiphertextCommitmentEquality)?;
    let grouped: BatchedGroupedCiphertext3HandlesValidityProofContext = context(
        a.grouped,
        ProofType::BatchedGroupedCiphertext3HandlesValidity,
    )?;
    let range: BatchedRangeProofContext = context(a.range, ProofType::BatchedRangeProofU128)?;
    let proof = TransferProofContext::verify_and_extract(&equality, &grouped, &range)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    if proof.transfer_pubkeys.source != src.elgamal_pubkey
        || proof.transfer_pubkeys.destination != dst.elgamal_pubkey
        || mint_ct.auditor_elgamal_pubkey != proof.transfer_pubkeys.auditor.into()
    {
        return Err(AdmissionError::EncryptionKey);
    }
    let lo = proof
        .ciphertext_lo
        .try_extract_ciphertext(0)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    let hi = proof
        .ciphertext_hi
        .try_extract_ciphertext(0)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    let new_source = arithmetic::subtract_with_lo_hi(&src.available_balance, &lo, &hi)
        .ok_or(AdmissionError::Funding)?;
    if new_source != proof.new_source_ciphertext {
        return Err(AdmissionError::Funding);
    }
    if bytemuck::bytes_of(&new_source) != a.expected_new_source_ciphertext {
        return Err(AdmissionError::Successor);
    }
    let auditor_lo = proof
        .ciphertext_lo
        .try_extract_ciphertext(2)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    let auditor_hi = proof
        .ciphertext_hi
        .try_extract_ciphertext(2)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    if instruction.transfer_amount_auditor_ciphertext_lo != auditor_lo
        || instruction.transfer_amount_auditor_ciphertext_hi != auditor_hi
    {
        return Err(AdmissionError::Auditor);
    }
    // Native destination execution can also fail on malformed ciphertexts.
    let dst_lo = proof
        .ciphertext_lo
        .try_extract_ciphertext(1)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    let dst_hi = proof
        .ciphertext_hi
        .try_extract_ciphertext(1)
        .map_err(|_| AdmissionError::ProofRelationship)?;
    arithmetic::add(&dst.pending_balance_lo, &dst_lo).ok_or(AdmissionError::Destination)?;
    arithmetic::add(&dst.pending_balance_hi, &dst_hi).ok_or(AdmissionError::Destination)?;
    let lo = PodRistrettoPoint(grouped.grouped_ciphertext_lo.extract_commitment().0);
    let hi = PodRistrettoPoint(grouped.grouped_ciphertext_hi.extract_commitment().0);
    let mut shift = [0u8; 32];
    shift[2] = 1;
    let hi = multiply_ristretto(&PodScalar(shift), &hi).ok_or(AdmissionError::Commitment)?;
    let amount_commitment = add_ristretto(&lo, &hi).ok_or(AdmissionError::Commitment)?.0;
    if &amount_commitment != a.expected_commitment {
        return Err(AdmissionError::Commitment);
    }
    Ok(ValidatedAction {
        amount_commitment,
        new_source_ciphertext: new_source.0,
    })
}
