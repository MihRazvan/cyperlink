//! Generated custom-policy-v1 admission for one release and its owning MXE.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use arcium_anchor::prelude::*;
use solana_sha256_hasher::hashv;
include!("deployment.rs");
use cyperlink_custom_policy_layout::{
    query_hash, state_ciphers, state_hash, valid_permit, valid_state, PERMIT_IDENTITY, PERMIT_LEN,
};
fn identity() -> [u8; 96] {
    cyperlink_custom_policy_layout::identity(&RELEASE_ID, &SCHEMA_ID, &DOMAIN_ID)
}
fn require_definition_authority(quota: &AccountInfo, payer: &Pubkey) -> Result<()> {
    let q = quota.try_borrow_data()?;
    require!(
        valid_state(&q, &identity()) && &q[96..128] == payer.as_ref(),
        JoinError::Authority
    );
    Ok(())
}
const COMP_DEF_OFFSET_RUNTIME_POLICY_INIT: u32 = comp_def_offset("runtime_policy_init");
const COMP_DEF_OFFSET_RUNTIME_POLICY_EVALUATE: u32 = comp_def_offset("runtime_policy_evaluate");

fn policy<'a>(
    data: Vec<u8>,
    quota: AccountInfo<'a>,
    permit: Option<AccountInfo<'a>>,
    authority: AccountInfo<'a>,
    program: AccountInfo<'a>,
) -> Result<()> {
    let (_, bump) = Pubkey::find_program_address(&[b"admission"], &ID);
    let mut metas = vec![];
    let mut infos = vec![];
    if let Some(p) = permit {
        metas.push(AccountMeta::new(*p.key, false));
        infos.push(p);
    }
    metas.push(AccountMeta::new(*quota.key, false));
    infos.push(quota);
    metas.push(AccountMeta::new_readonly(*authority.key, true));
    infos.push(authority);
    infos.push(program);
    invoke_signed(
        &Instruction {
            program_id: H,
            accounts: metas,
            data,
        },
        &infos,
        &[&[b"admission", &[bump]]],
    )?;
    Ok(())
}
fn next_nonce(q: &[u8]) -> Result<u128> {
    require!(valid_state(&q, &identity()), JoinError::Context);
    Ok(u64::from_le_bytes(q[88..96].try_into().unwrap())
        .checked_add(1)
        .ok_or(JoinError::Context)? as u128)
}
/// Bind the owner's signed query to one exact shared-state snapshot and nonce counter.
/// Every state byte is covered, including identity, ciphertexts and admission counter.
fn require_query_snapshot(quota: &[u8], expected: &[u8; 32]) -> Result<()> {
    require!(valid_state(quota, &identity()), JoinError::Context);
    let actual = query_hash(quota);
    require!(&actual == expected, JoinError::QueryStateChanged);
    Ok(())
}
fn extra(key: Pubkey, w: bool) -> arcium_client::idl::arcium::types::CallbackAccount {
    arcium_client::idl::arcium::types::CallbackAccount {
        pubkey: key,
        is_writable: w,
    }
}

#[arcium_program]
pub mod cyperlink_auth {
    use super::*;
    /// The local deployment authority chooses the administrator once, before MXE initialization.
    pub fn provision_quota(ctx: Context<ProvisionQuota>) -> Result<()> {
        let (_, bump) = Pubkey::find_program_address(&[b"admission"], &ID);
        let ix = Instruction {
            program_id: H,
            data: vec![6],
            accounts: vec![
                AccountMeta::new(Q, false),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new_readonly(ctx.accounts.admission.key(), true),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            ],
        };
        invoke_signed(
            &ix,
            &[
                ctx.accounts.quota.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.admission.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.policy_program.to_account_info(),
            ],
            &[&[b"admission", &[bump]]],
        )?;
        Ok(())
    }
    pub fn init_runtime_policy_init_comp_def(
        ctx: Context<InitRuntimePolicyInitCompDef>,
    ) -> Result<()> {
        require_definition_authority(&ctx.accounts.quota, &ctx.accounts.payer.key())?;
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }
    pub fn init_runtime_policy_evaluate_comp_def(
        ctx: Context<InitRuntimePolicyEvaluateCompDef>,
    ) -> Result<()> {
        require_definition_authority(&ctx.accounts.quota, &ctx.accounts.payer.key())?;
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }
    pub fn prepare_action(
        ctx: Context<PrepareAction>,
        _action_id: u64,
        template: Vec<u8>,
        native_data: Vec<u8>,
    ) -> Result<()> {
        require!(
            template.len() == 464 && native_data.len() <= 256,
            JoinError::Context
        );
        let a = &mut ctx.accounts.action;
        a.owner = ctx.accounts.source_owner.key();
        a.template.copy_from_slice(&template);
        a.native_data = native_data;
        Ok(())
    }
    pub fn runtime_policy_init(
        ctx: Context<RuntimePolicyInit>,
        computation_offset: u64,
        pubkey: [u8; 32],
        client_nonce: u128,
        initial_ct: [[u8; 32]; 4],
    ) -> Result<()> {
        let q = ctx.accounts.quota.try_borrow_data()?;
        require!(
            valid_state(&q, &identity())
                && q[128] == 0
                && &q[96..128] == ctx.accounts.payer.key().as_ref(),
            JoinError::Authority
        );
        let nonce = next_nonce(&q)?;
        drop(q);
        let job = &mut ctx.accounts.job;
        job.kind = 0;
        job.status = 0;
        job.owner = ctx.accounts.payer.key();
        job.computation = ctx.accounts.computation_account.key();
        job.nonce = nonce;
        job.expiry = Clock::get()?.slot + 2000;
        job.inputs_hash = hashv(&[
            &pubkey,
            &client_nonce.to_le_bytes(),
            initial_ct.as_flattened(),
            &nonce.to_le_bytes(),
            &identity(),
        ])
        .to_bytes();
        policy(
            vec![3],
            ctx.accounts.quota.to_account_info(),
            None,
            ctx.accounts.admission.to_account_info(),
            ctx.accounts.policy_program.to_account_info(),
        )?;
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(client_nonce);
        for ct in initial_ct {
            builder = builder.encrypted_u128(ct);
        }
        let args = builder.plaintext_u128(nonce).build();
        let accounts = vec![
            extra(job.key(), true),
            extra(Q, true),
            extra(H, false),
            extra(ctx.accounts.admission.key(), false),
        ];
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RuntimePolicyInitCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &accounts,
            )?],
            1,
            0,
            0,
        )?;
        Ok(())
    }
    #[arcium_callback(encrypted_ix = "runtime_policy_init")]
    pub fn runtime_policy_init_callback(
        ctx: Context<RuntimePolicyInitCallback>,
        output: SignedComputationOutputs<RuntimePolicyInitOutput>,
    ) -> Result<()> {
        let out = output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        )?;
        let job = &mut ctx.accounts.job;
        require!(
            job.kind == 0 && job.status == 0 && Clock::get()?.slot <= job.expiry,
            JoinError::State
        );
        if !out.field_0 {
            job.status = 2;
            emit!(Admitted {
                job: job.key(),
                status: 2
            });
            return Ok(());
        }
        let mut data = vec![2];
        data.extend(job.nonce.to_le_bytes());
        for ct in out.field_1 {
            data.extend(ct);
        }
        policy(
            data,
            ctx.accounts.quota.to_account_info(),
            None,
            ctx.accounts.admission.to_account_info(),
            ctx.accounts.policy_program.to_account_info(),
        )?;
        job.status = 1;
        emit!(Admitted {
            job: job.key(),
            status: job.status
        });
        Ok(())
    }
    pub fn runtime_policy_evaluate(
        ctx: Context<RuntimePolicyEvaluate>,
        computation_offset: u64,
        pubkey: [u8; 32],
        client_nonce: u128,
        amount_ct: [u8; 32],
        opening_ct: [u8; 32],
        expiry: u64,
        expected_query_state: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.remaining_accounts.len() == 8
                && ctx.accounts.action.owner == ctx.accounts.source_owner.key(),
            JoinError::Authority
        );
        let now = Clock::get()?.slot;
        require!(expiry > now && expiry <= now + 2000, JoinError::State);
        require!(
            ctx.remaining_accounts[0].owner
                == &"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
                    .parse::<Pubkey>()
                    .unwrap(),
            JoinError::Context
        );
        let raw = ctx.remaining_accounts[0].try_borrow_data()?;
        require!(
            raw.len() >= 64 && &raw[32..64] == ctx.accounts.source_owner.key().as_ref(),
            JoinError::Authority
        );
        drop(raw);
        let a = ctx.remaining_accounts;
        let mut template = [0u8; PERMIT_LEN];
        template[..464].copy_from_slice(&ctx.accounts.action.template);
        require!(
            &template[176..208] == ctx.accounts.source_owner.key().as_ref()
                && &template[400..432] == a[6].key.as_ref()
                && a[6].executable,
            JoinError::Context
        );
        require!(
            a[6].key.to_bytes() == MERCHANT_ID || a[6].key.to_bytes() == LICENSE_ID,
            JoinError::Context
        );
        for (offset, idx) in [(80, 0), (112, 1), (144, 2)] {
            require!(
                &template[offset..offset + 32] == a[idx].key.as_ref(),
                JoinError::Context
            );
        }
        require!(
            hashv(&[&a[0].try_borrow_data()?]).as_ref() == &template[208..240],
            JoinError::Context
        );
        let eq = a[3].try_borrow_data()?;
        let val = a[4].try_borrow_data()?;
        let range = a[5].try_borrow_data()?;
        let owner = ctx.accounts.source_owner.key();
        let digest = hashv(&[
            &ctx.accounts.action.native_data,
            a[0].key.as_ref(),
            a[1].key.as_ref(),
            a[2].key.as_ref(),
            a[3].key.as_ref(),
            a[4].key.as_ref(),
            a[5].key.as_ref(),
            owner.as_ref(),
            &eq,
            &val,
            &range,
        ]);
        require!(digest.as_ref() == &template[240..272], JoinError::Context);
        drop(eq);
        drop(val);
        drop(range);
        require!(
            ctx.accounts.permit.data_len() == PERMIT_LEN
                && ctx
                    .accounts
                    .permit
                    .try_borrow_data()?
                    .iter()
                    .all(|b| *b == 0),
            JoinError::State
        );

        cyperlink_hook_routing::validate_metadata(
            a[1].key.as_array(),
            Q.as_array(),
            H.as_array(),
            a[7].key.as_array(),
            a[7].owner.as_array(),
            &a[7].try_borrow_data()?,
        )
        .map_err(|_| error!(JoinError::Context))?;
        // Reject unsupported or unfunded native queries BEFORE allocating a nonce or MPC work.
        // Snapshot/owner/consumer hashes above remain part of this immutable operation.
        let source_data = a[0].try_borrow_data()?;
        let mint_data = a[1].try_borrow_data()?;
        let destination_data = a[2].try_borrow_data()?;
        let equality_data = a[3].try_borrow_data()?;
        let grouped_data = a[4].try_borrow_data()?;
        let range_data = a[5].try_borrow_data()?;
        let view = |i: usize, data| cyperlink_native_admission::AccountView {
            key: a[i].key.as_array(),
            owner: a[i].owner.as_array(),
            data,
        };
        let validated =
            cyperlink_native_admission::validate(&cyperlink_native_admission::NoFeeAction {
                source: view(0, &source_data),
                mint: view(1, &mint_data),
                destination: view(2, &destination_data),
                equality: view(3, &equality_data),
                grouped: view(4, &grouped_data),
                range: view(5, &range_data),
                owner: owner.as_array(),
                owner_signed: ctx.accounts.source_owner.is_signer,
                owner_account_owner: ctx.accounts.source_owner.owner.as_array(),
                owner_account_data_len: ctx.accounts.source_owner.data_len(),
                native_instruction: &ctx.accounts.action.native_data,
                expected_hook: H.as_array(),
                expected_commitment: template[336..368].try_into().unwrap(),
                expected_new_source_ciphertext: template[272..336].try_into().unwrap(),
            })
            .map_err(|_| error!(JoinError::Context))?;
        let expected = validated.amount_commitment;
        drop(source_data);
        drop(mint_data);
        drop(destination_data);
        drop(equality_data);
        drop(grouped_data);
        drop(range_data);
        let q = ctx.accounts.quota.try_borrow_data()?;
        require!(
            valid_state(&q, &identity()) && q[128] == 1,
            JoinError::State
        );
        require!(
            &q[96..128] == ctx.accounts.payer.key().as_ref(),
            JoinError::Authority
        );
        require!(q[129..161].iter().all(|byte| *byte == 0), JoinError::State);
        // A competing query consumes a nonce even when it does not advance quota state.
        // Reject either kind of drift before any MPC query or durable allocation survives.
        require_query_snapshot(&q, &expected_query_state)?;
        let nonce = next_nonce(&q)?;
        let old_nonce = u128::from_le_bytes(q[40..56].try_into().unwrap());
        let old_ct = state_ciphers(&q);
        template[0] = 0;
        template[1] = 0;
        template[8..16].copy_from_slice(&q[..8]);
        template[16..48].copy_from_slice(&q[8..40]);
        template[48..80].fill(0);
        template[368..400].copy_from_slice(Q.as_ref());
        template[464..480].copy_from_slice(&nonce.to_le_bytes());
        template[480..512].fill(0);
        template[512..520].copy_from_slice(&expiry.to_le_bytes());
        template[PERMIT_IDENTITY..].copy_from_slice(&identity());
        drop(q);
        ctx.accounts.permit_claim.job = ctx.accounts.job.key();
        ctx.accounts.permit_claim.owner = owner;
        let job = &mut ctx.accounts.job;
        job.kind = 1;
        job.status = 0;
        job.owner = owner;
        job.computation = ctx.accounts.computation_account.key();
        job.permit = ctx.accounts.permit.key();
        job.nonce = nonce;
        job.expiry = expiry;
        job.template = template;
        job.inputs_hash = hashv(&[
            &pubkey,
            &client_nonce.to_le_bytes(),
            &amount_ct,
            &opening_ct,
            &old_nonce.to_le_bytes(),
            old_ct.as_flattened(),
            &nonce.to_le_bytes(),
            &expected,
            &identity(),
        ])
        .to_bytes();
        policy(
            vec![3],
            ctx.accounts.quota.to_account_info(),
            None,
            ctx.accounts.admission.to_account_info(),
            ctx.accounts.policy_program.to_account_info(),
        )?;
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(client_nonce)
            .encrypted_u128(amount_ct)
            .encrypted_u128(opening_ct)
            .plaintext_u128(old_nonce);
        for ct in old_ct {
            builder = builder.encrypted_u128(ct);
        }
        builder = builder.plaintext_u128(nonce);
        for byte in expected {
            builder = builder.plaintext_u8(byte);
        }
        let args = builder.build();
        let accounts = vec![
            extra(job.key(), true),
            extra(Q, true),
            extra(H, false),
            extra(ctx.accounts.admission.key(), false),
            extra(job.permit, true),
        ];
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RuntimePolicyEvaluateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &accounts,
            )?],
            1,
            0,
            0,
        )?;
        Ok(())
    }
    #[arcium_callback(encrypted_ix = "runtime_policy_evaluate")]
    pub fn runtime_policy_evaluate_callback(
        ctx: Context<RuntimePolicyEvaluateCallback>,
        output: SignedComputationOutputs<RuntimePolicyEvaluateOutput>,
    ) -> Result<()> {
        let out = output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        )?;
        let job = &mut ctx.accounts.job;
        require!(job.kind == 1 && job.status == 0, JoinError::State);
        if Clock::get()?.slot > job.expiry {
            job.status = 4;
            return Ok(());
        }
        if out.field_0 != job.template[336..368] {
            job.status = 2;
            emit!(Admitted {
                job: job.key(),
                status: 2
            });
            return Ok(());
        }
        if !out.field_1 {
            job.status = 2;
            emit!(Admitted {
                job: job.key(),
                status: 2
            });
            return Ok(());
        }
        let q = ctx.accounts.quota.try_borrow_data()?;
        require!(
            valid_state(&q, &identity()) && valid_permit(&job.template, &identity()),
            JoinError::Context
        );
        if q[..8] != job.template[8..16] || q[8..40] != job.template[16..48] {
            job.status = 4;
            return Ok(());
        }
        drop(q);
        let mut permit = job.template;
        permit[1] = 1;
        permit[480..512].copy_from_slice(&out.field_2[0]);
        for i in 1..4 {
            permit[520 + (i - 1) * 32..520 + i * 32].copy_from_slice(&out.field_2[i]);
        }
        let successor = state_hash(&permit[464..512], &permit[520..616], &identity());
        permit[48..80].copy_from_slice(&successor);
        let mut data = vec![4];
        data.extend(permit);
        policy(
            data,
            ctx.accounts.quota.to_account_info(),
            Some(ctx.accounts.permit.to_account_info()),
            ctx.accounts.admission.to_account_info(),
            ctx.accounts.policy_program.to_account_info(),
        )?;
        job.status = 1;
        emit!(Admitted {
            job: job.key(),
            status: 1
        });
        Ok(())
    }
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.kind == 1
                && (job.status == 0 || job.status == 1)
                && job.owner == ctx.accounts.owner.key(),
            JoinError::Authority
        );
        policy(
            vec![5],
            ctx.accounts.quota.to_account_info(),
            Some(ctx.accounts.permit.to_account_info()),
            ctx.accounts.admission.to_account_info(),
            ctx.accounts.policy_program.to_account_info(),
        )?;
        job.status = 3;
        Ok(())
    }
}
#[derive(Accounts)]
pub struct ProvisionQuota<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(address=Pubkey::find_program_address(&[ID.as_ref()],&anchor_lang::solana_program::bpf_loader_upgradeable::ID).0,
   constraint=program_data.upgrade_authority_address==Some(payer.key()) @ JoinError::Authority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(mut,address=Q)]
    /// CHECK: H creates its canonical quota PDA; only auth deployment authority may select admin.
    pub quota: UncheckedAccount<'info>,
    #[account(address=H,executable)]
    /// CHECK: fixed hook program.
    pub policy_program: UncheckedAccount<'info>,
    #[account(seeds=[b"admission"],bump)]
    /// CHECK: restricted H provisioning authority.
    pub admission: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Job {
    pub kind: u8,
    pub status: u8,
    pub owner: Pubkey,
    pub computation: Pubkey,
    pub permit: Pubkey,
    pub nonce: u128,
    pub expiry: u64,
    pub template: [u8; 712],
    pub inputs_hash: [u8; 32],
}
#[account]
pub struct PreparedAction {
    pub owner: Pubkey,
    pub template: [u8; 464],
    pub native_data: Vec<u8>,
}
#[derive(Accounts)]
#[instruction(action_id:u64)]
pub struct PrepareAction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub source_owner: Signer<'info>,
    #[account(init,payer=payer,space=1200,seeds=[b"action".as_ref(),source_owner.key().as_ref(),&action_id.to_le_bytes()],bump)]
    pub action: Box<Account<'info, PreparedAction>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Cancel<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub job: Box<Account<'info, Job>>,
    #[account(mut,address=job.permit,owner=H)]
    /// CHECK: pinned H permit.
    pub permit: UncheckedAccount<'info>,
    #[account(mut,address=Q,owner=H)]
    /// CHECK: fixed H quota.
    pub quota: UncheckedAccount<'info>,
    #[account(address=H)]
    /// CHECK: fixed H program.
    pub policy_program: UncheckedAccount<'info>,
    #[account(seeds=[b"admission"],bump)]
    /// CHECK: restricted authority PDA.
    pub admission: UncheckedAccount<'info>,
}
#[event]
pub struct Admitted {
    pub job: Pubkey,
    pub status: u8,
}
#[error_code]
pub enum JoinError {
    Context,
    Authority,
    State,
    Denied,
    QueryStateChanged,
}

#[queue_computation_accounts("runtime_policy_init", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RuntimePolicyInit<'info> {
    #[account(init,payer=payer,space=1200,seeds=[b"job".as_ref(),&computation_offset.to_le_bytes()],bump)]
    pub job: Box<Account<'info, Job>>,
    #[account(mut,address=Q,owner=H)]
    /// CHECK: fixed H state, checked layout in handler.
    pub quota: UncheckedAccount<'info>,
    #[account(address=H)]
    /// CHECK: fixed H executable.
    pub policy_program: UncheckedAccount<'info>,
    #[account(seeds=[b"admission"],bump)]
    /// CHECK: callback-only authority PDA.
    pub admission: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_RUNTIME_POLICY_INIT)
    )]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("runtime_policy_init")]
#[derive(Accounts)]
pub struct RuntimePolicyInitCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_RUNTIME_POLICY_INIT)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: address is validated by the Arcium program; verify_output reads slot data from it.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(mut,constraint=job.computation==computation_account.key() @ JoinError::Context)]
    pub job: Box<Account<'info, Job>>,
    #[account(mut,address=Q,owner=H)]
    /// CHECK: fixed H state, checked in handler.
    pub quota: UncheckedAccount<'info>,
    #[account(address=H)]
    /// CHECK: fixed H executable.
    pub policy_program: UncheckedAccount<'info>,
    #[account(seeds=[b"admission"],bump)]
    /// CHECK: restricted admission authority.
    pub admission: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("runtime_policy_init", payer)]
#[derive(Accounts)]
pub struct InitRuntimePolicyInitCompDef<'info> {
    #[account(address=Q,owner=H)]
    /// CHECK: compiled release state and definition-registration administrator.
    pub quota: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("runtime_policy_evaluate", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RuntimePolicyEvaluate<'info> {
    #[account(init,payer=payer,space=72,seeds=[b"permit-claim".as_ref(),permit.key().as_ref()],bump)]
    pub permit_claim: Box<Account<'info, PermitClaim>>,

    #[account(init,payer=payer,space=1200,seeds=[b"job".as_ref(),&computation_offset.to_le_bytes()],bump)]
    pub job: Box<Account<'info, Job>>,
    #[account(mut,address=Q,owner=H)]
    /// CHECK: fixed H state, checked layout in handler.
    pub quota: UncheckedAccount<'info>,
    #[account(address=H)]
    /// CHECK: fixed H executable.
    pub policy_program: UncheckedAccount<'info>,
    #[account(seeds=[b"admission"],bump)]
    /// CHECK: callback-only authority PDA.
    pub admission: UncheckedAccount<'info>,

    pub source_owner: Signer<'info>,
    pub action: Box<Account<'info, PreparedAction>>,
    #[account(mut,owner=H)]
    /// CHECK: empty fixed-size H permit, admitted only through callback.
    pub permit: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_RUNTIME_POLICY_EVALUATE)
    )]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("runtime_policy_evaluate")]
#[derive(Accounts)]
pub struct RuntimePolicyEvaluateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_RUNTIME_POLICY_EVALUATE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: address is validated by the Arcium program; verify_output reads slot data from it.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(mut,constraint=job.computation==computation_account.key() @ JoinError::Context)]
    pub job: Box<Account<'info, Job>>,
    #[account(mut,address=Q,owner=H)]
    /// CHECK: fixed H state, checked in handler.
    pub quota: UncheckedAccount<'info>,
    #[account(address=H)]
    /// CHECK: fixed H executable.
    pub policy_program: UncheckedAccount<'info>,
    #[account(seeds=[b"admission"],bump)]
    /// CHECK: restricted admission authority.
    pub admission: UncheckedAccount<'info>,

    #[account(mut,address=job.permit,owner=H)]
    /// CHECK: pinned empty H permit.
    pub permit: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("runtime_policy_evaluate", payer)]
#[derive(Accounts)]
pub struct InitRuntimePolicyEvaluateCompDef<'info> {
    #[account(address=Q,owner=H)]
    /// CHECK: compiled release state and definition-registration administrator.
    pub quota: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct PermitClaim {
    pub job: Pubkey,
    pub owner: Pubkey,
}

#[cfg(test)]
mod query_snapshot_tests {
    use super::*;
    use cyperlink_custom_policy_layout::{STATE_IDENTITY, STATE_LEN};
    fn snapshot() -> [u8; STATE_LEN] {
        let mut q = [0; STATE_LEN];
        q[STATE_IDENTITY..].copy_from_slice(&identity());
        q
    }
    #[test]
    fn exact_query_and_nonce() {
        let q = snapshot();
        require_query_snapshot(&q, &query_hash(&q)).unwrap();
        assert_eq!(next_nonce(&q).unwrap(), 1);
    }
    #[test]
    fn any_changed_byte_rejects_signed_query() {
        let q = snapshot();
        let hash = query_hash(&q);
        for i in 0..STATE_LEN {
            let mut changed = q;
            changed[i] ^= 1;
            assert!(
                require_query_snapshot(&changed, &hash).is_err(),
                "byte {}",
                i
            );
        }
    }
    #[test]
    fn old_layout_rejected() {
        assert!(require_query_snapshot(&[0; 161], &[0; 32]).is_err());
    }
    #[test]
    fn nonce_exhaustion_cannot_wrap_or_reuse_an_encryption_nonce() {
        let mut q = snapshot();
        q[88..96].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(next_nonce(&q).is_err());
    }
}
