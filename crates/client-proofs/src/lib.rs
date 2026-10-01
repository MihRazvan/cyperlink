//! Client-only confidential key persistence and native proof preparation.
//! Outputs are unsigned preparation artifacts, never verified account state.
use serde_json::{json, Value};
use solana_address::Address;
use solana_instruction::Instruction;
use solana_sha256_hasher::hash;
use solana_zk_elgamal_proof_interface::{
    instruction::{ContextStateInfo, ProofInstruction},
    proof_data::ZkProofData,
};
use solana_zk_sdk::{
    encryption::{
        auth_encryption::AeKey,
        elgamal::{ElGamalKeypair, ElGamalPubkey},
        pedersen::Pedersen,
    },
    zk_elgamal_proof_program::{build_pubkey_validity_proof_data, VerifyZkProof},
};
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::{
            instruction::{inner_configure_account, inner_transfer},
            ConfidentialTransferAccount,
        },
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::{Account, AccountState},
};
use spl_token_confidential_transfer_proof_extraction::instruction::ProofLocation;
use spl_token_confidential_transfer_proof_generation::transfer::research_transfer_split_with_opening;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::{
    error::Error,
    fs::OpenOptions,
    io::{Read, Write},
    path::Path,
};
use zeroize::Zeroizing;

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;
const KEY_HEADER: &[u8; 8] = b"CYPKEY01";

/// Reusable account-wide secrets. Keep this type in the wallet/client process.
/// Deliberately has no Serialize or Debug implementation.
pub struct ClientKeys {
    elgamal: ElGamalKeypair,
    aes: AeKey,
}

impl ClientKeys {
    pub fn generate() -> Self {
        Self {
            elgamal: ElGamalKeypair::new_rand(),
            aes: AeKey::new_rand(),
        }
    }
    pub fn elgamal(&self) -> &ElGamalKeypair {
        &self.elgamal
    }
    pub fn aes(&self) -> &AeKey {
        &self.aes
    }
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.elgamal.pubkey().to_bytes())
    }

    pub fn save_new(&self, path: &Path) -> Result<()> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(88));
        bytes.extend_from_slice(KEY_HEADER);
        let elgamal = Zeroizing::new(<[u8; 64]>::from(&self.elgamal));
        let aes = Zeroizing::new(<[u8; 16]>::from(&self.aes));
        bytes.extend_from_slice(elgamal.as_ref());
        bytes.extend_from_slice(aes.as_ref());
        write_new(path, &bytes, true)
    }

    pub fn load(path: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.mode() & 0o077 != 0
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err("key file must be a private regular file owned by the current user".into());
        }
        let mut bytes = Zeroizing::new(Vec::new());
        file.take(89).read_to_end(&mut bytes)?;
        if bytes.len() != 88 || &bytes[..8] != KEY_HEADER {
            return Err("invalid client key file".into());
        }
        Ok(Self {
            elgamal: ElGamalKeypair::try_from(&bytes[8..72])?,
            aes: AeKey::try_from(&bytes[72..88])?,
        })
    }
}

/// Create-only writes prevent overwriting existing reusable keys or witnesses.
pub fn write_new(path: &Path, bytes: &[u8], private: bool) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(if private { 0o600 } else { 0o644 })
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

pub fn instruction_json(ix: &Instruction) -> Value {
    json!({"program": ix.program_id.to_string(), "data": hex::encode(&ix.data),
        "accounts": ix.accounts.iter().map(|meta| json!({"key": meta.pubkey.to_string(), "signer":meta.is_signer, "writable":meta.is_writable})).collect::<Vec<_>>()})
}

pub struct TransferAddresses {
    pub source: Address,
    pub mint: Address,
    pub destination: Address,
    pub owner: Address,
    pub equality: Address,
    pub grouped: Address,
    pub range: Address,
}

/// Per-operation secrets only: no account-wide ElGamal or AES key.
/// Export exclusively into a private client witness file for subsequent encryption.
pub struct OperationWitness {
    amount: u64,
    opening: Zeroizing<[u8; 32]>,
    commitment: [u8; 32],
    source_hash: String,
}
impl OperationWitness {
    pub fn save_new(&self, path: &Path) -> Result<()> {
        let bytes = Zeroizing::new(serde_json::to_vec_pretty(&json!({
            "schema_version":1, "classification":"private-client-operation-witness",
            "amount":self.amount, "opening":self.opening.as_slice(),
            "commitment":self.commitment, "source_data_sha256":self.source_hash,
        }))?);
        write_new(path, &bytes, true)
    }
    /// Feed only these operation-scoped values into client-side MPC encryption.
    pub fn amount(&self) -> u64 {
        self.amount
    }
    pub fn opening_bytes(&self) -> &[u8; 32] {
        &self.opening
    }
}

pub struct PreparedTransfer {
    pub public: Value,
    pub witness: OperationWitness,
}

/// Prepare a fresh no-fee transfer from the CURRENT account bytes. Every proof
/// is freshly generated and verified locally; native verification is still required.
pub fn prepare_transfer(
    keys: &ClientKeys,
    source_data: &[u8],
    amount: u64,
    addresses: &TransferAddresses,
    destination_key: &ElGamalPubkey,
    auditor_key: Option<&ElGamalPubkey>,
) -> Result<PreparedTransfer> {
    if amount == 0 || amount >= 1u64 << 48 {
        return Err("transfer amount must be in 1..2^48".into());
    }
    let source = StateWithExtensions::<Account>::unpack(source_data)?;
    if source.base.owner != addresses.owner
        || source.base.mint != addresses.mint
        || source.base.state != AccountState::Initialized
    {
        return Err("source owner, mint, or account state does not match request".into());
    }
    let ct = source.get_extension::<ConfidentialTransferAccount>()?;
    ct.valid_as_source()?;
    if ct.elgamal_pubkey.0 != keys.elgamal.pubkey().to_bytes() {
        return Err("client ElGamal key does not own this confidential account".into());
    }
    let current = ct.available_balance.try_into()?;
    let decryptable = ct.decryptable_available_balance.try_into()?;
    let balance = keys
        .aes
        .decrypt(&decryptable)
        .ok_or("cannot decrypt current client balance")?;
    let remaining = balance
        .checked_sub(amount)
        .ok_or("insufficient available balance")?;
    let (proofs, opening) = research_transfer_split_with_opening(
        &current,
        &decryptable,
        amount,
        &keys.elgamal,
        &keys.aes,
        destination_key,
        auditor_key,
    )?;
    let eq = &proofs.equality_proof_data;
    let grouped = &proofs.ciphertext_validity_proof_data_with_ciphertext;
    let range = &proofs.range_proof_data;
    eq.verify_proof()?;
    grouped.proof_data.verify_proof()?;
    range.verify_proof()?;
    let new_decryptable = keys.aes.encrypt(remaining).into();
    let native = inner_transfer(
        &spl_token_2022_interface::id(),
        &addresses.source,
        &addresses.mint,
        &addresses.destination,
        &new_decryptable,
        &grouped.ciphertext_lo,
        &grouped.ciphertext_hi,
        &addresses.owner,
        &[],
        ProofLocation::ContextStateAccount(&addresses.equality),
        ProofLocation::ContextStateAccount(&addresses.grouped),
        ProofLocation::ContextStateAccount(&addresses.range),
    )?;
    let commitment = Pedersen::with(amount, &opening).to_bytes();
    // Explicit hex hashes match the operation template's SHA256 bytes.
    let source_hash = hex::encode(hash(source_data).to_bytes());
    let make = |name: &str,
                address: &Address,
                ix: Instruction,
                proof_data: &[u8],
                context_size: usize| {
        json!({"name":name,"context_address":address.to_string(),"context_account_size":33+context_size,
            "proof_data":hex::encode(proof_data),"verify_instruction":instruction_json(&ix)})
    };
    let public = json!({
        "schema_version":1,"evidence_level":"client-proof-preparation-only",
        "native_verification_required":true,"owner_signature_required":true,
        "source_data_sha256":source_hash,"source":addresses.source.to_string(),"mint":addresses.mint.to_string(),
        "destination":addresses.destination.to_string(),"owner":addresses.owner.to_string(),
        "source_elgamal_pubkey":keys.public_key_hex(),
        "expected_commitment":hex::encode(commitment),
        "expected_new_source_ciphertext":hex::encode(eq.context.ciphertext.0),
        "new_decryptable_available_balance":hex::encode(bytemuck::bytes_of(&new_decryptable)),
        "native_instruction":instruction_json(&native),
        "proofs":[
            make("equality",&addresses.equality,ProofInstruction::VerifyCiphertextCommitmentEquality.encode_verify_proof(Some(ContextStateInfo{context_state_account:&addresses.equality,context_state_authority:&addresses.owner}),eq),bytemuck::bytes_of(eq),std::mem::size_of_val(eq.context_data())),
            make("grouped",&addresses.grouped,ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity.encode_verify_proof(Some(ContextStateInfo{context_state_account:&addresses.grouped,context_state_authority:&addresses.owner}),&grouped.proof_data),bytemuck::bytes_of(&grouped.proof_data),std::mem::size_of_val(grouped.proof_data.context_data())),
            make("range",&addresses.range,ProofInstruction::VerifyBatchedRangeProofU128.encode_verify_proof(Some(ContextStateInfo{context_state_account:&addresses.range,context_state_authority:&addresses.owner}),range),bytemuck::bytes_of(range),std::mem::size_of_val(range.context_data())),
        ]
    });
    Ok(PreparedTransfer {
        public,
        witness: OperationWitness {
            amount,
            opening: Zeroizing::new(opening.to_bytes()),
            commitment,
            source_hash,
        },
    })
}

pub fn configure_proof(
    keys: &ClientKeys,
    token_account: &Address,
    mint: &Address,
    owner: &Address,
    context_account: &Address,
    max_pending_credits: u64,
) -> Result<Value> {
    if max_pending_credits == 0 {
        return Err("maximum pending credits must be positive".into());
    }
    let proof = build_pubkey_validity_proof_data(&keys.elgamal)?;
    proof.verify_proof()?;
    let zero = keys.aes.encrypt(0).into();
    let verify = ProofInstruction::VerifyPubkeyValidity.encode_verify_proof(
        Some(ContextStateInfo {
            context_state_account: context_account,
            context_state_authority: owner,
        }),
        &proof,
    );
    let configure = inner_configure_account(
        &spl_token_2022_interface::id(),
        token_account,
        mint,
        &zero,
        max_pending_credits,
        owner,
        &[],
        ProofLocation::ContextStateAccount(context_account),
    )?;
    Ok(
        json!({"schema_version":1,"evidence_level":"client-proof-preparation-only",
        "native_verification_required":true,"owner_signature_required":true,
        "elgamal_pubkey":keys.public_key_hex(),"context_address":context_account.to_string(),
        "context_account_size":33+std::mem::size_of_val(proof.context_data()),
        "proof_data":hex::encode(bytemuck::bytes_of(&proof)),
        "verify_instruction":instruction_json(&verify),"configure_instruction":instruction_json(&configure)}),
    )
}

pub fn read_public_key(hex_key: &str) -> Result<ElGamalPubkey> {
    Ok(ElGamalPubkey::try_from(hex::decode(hex_key)?.as_slice())?)
}

/// Synthetic-local setup plan using native extension constructors. The caller
/// creates/funds accounts and signs/submits these instructions on its validator.
/// Public mint/deposit amounts are explicitly observer-visible setup information.
pub fn provision_plan(
    keys: &ClientKeys,
    source: &Address,
    mint: &Address,
    owner: &Address,
    pubkey_context: &Address,
    mint_authority: &Address,
    hook: &Address,
    initial_amount: u64,
    decimals: u8,
    max_pending_credits: u64,
) -> Result<Value> {
    use spl_token_2022_interface::{
        extension::{
            confidential_transfer::instruction as ct,
            transfer_hook::instruction as hook_instruction, ExtensionType,
        },
        instruction as token,
        state::Mint,
    };
    if initial_amount >= 1u64 << 48 {
        return Err("initial amount exceeds local profile".into());
    }
    let program = spl_token_2022_interface::id();
    let mint_size = ExtensionType::try_calculate_account_len::<Mint>(&[
        ExtensionType::ConfidentialTransferMint,
        ExtensionType::TransferHook,
    ])?;
    let token_size = ExtensionType::try_calculate_account_len::<Account>(&[
        ExtensionType::ConfidentialTransferAccount,
        ExtensionType::TransferHookAccount,
    ])?;
    let mint_initialization = [
        ct::initialize_mint(&program, mint, Some(*mint_authority), true, None)?,
        hook_instruction::initialize(&program, mint, Some(*mint_authority), Some(*hook))?,
        token::initialize_mint2(&program, mint, mint_authority, None, decimals)?,
    ];
    let token_initialization = token::initialize_account3(&program, source, mint, owner)?;
    let configuration = configure_proof(
        keys,
        source,
        mint,
        owner,
        pubkey_context,
        max_pending_credits,
    )?;
    let funding = if initial_amount == 0 {
        vec![]
    } else {
        vec![
            token::mint_to(&program, mint, source, mint_authority, &[], initial_amount)?,
            ct::deposit(&program, source, mint, initial_amount, decimals, owner, &[])?,
            ct::apply_pending_balance(
                &program,
                source,
                1,
                &keys.aes.encrypt(initial_amount).into(),
                owner,
                &[],
            )?,
        ]
    };
    Ok(
        json!({"schema_version":1,"evidence_level":"client-provisioning-plan-only",
        "observer_disclosure":{"synthetic_setup_amount":initial_amount,"decimals":decimals},
        "token_program":program.to_string(),"proof_program":solana_zk_elgamal_proof_interface::id().to_string(),
        "account_sizes":{"mint":mint_size,"token":token_size,"pubkey_context":configuration["context_account_size"]},
        "mint_initialization":mint_initialization.iter().map(instruction_json).collect::<Vec<_>>(),
        "token_initialization":instruction_json(&token_initialization),
        "configuration":configuration,"funding":funding.iter().map(instruction_json).collect::<Vec<_>>() }),
    )
}
