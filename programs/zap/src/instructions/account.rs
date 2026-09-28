use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::ZapError;
use crate::events::{AccountClosed, AccountCreated, Deposited, SessionChanged, Withdrawn};
use crate::state::{Config, Pool, TradingAccount};

fn validate_session(config: &Config, session_key: &Pubkey, expires_at: i64, now: i64) -> Result<()> {
    if *session_key != Pubkey::default() {
        require!(
            expires_at > now && expires_at <= now + i64::from(config.params.session_max_secs),
            ZapError::InvalidSessionExpiry
        );
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    pub owner: Signer<'info>,
    /// Pays the account rent (the relayer, so users never need SOL); refunded when the account closes.
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = rent_payer,
        space = TradingAccount::SIZE,
        seeds = [ACCOUNT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub account: AccountLoader<'info, TradingAccount>,
    pub system_program: Program<'info, System>,
}

pub fn create_account(ctx: Context<CreateAccount>, session_key: Pubkey, session_expires_at: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_session(&ctx.accounts.config, &session_key, session_expires_at, now)?;
    let mut acct = ctx.accounts.account.load_init()?;
    acct.owner = ctx.accounts.owner.key();
    acct.rent_payer = ctx.accounts.rent_payer.key();
    acct.session_key = session_key;
    acct.session_expires_at = if session_key == Pubkey::default() { 0 } else { session_expires_at };
    acct.created_at = now;
    acct.next_position_id = 1;
    acct.next_order_id = 1;
    acct.bump = ctx.bumps.account;
    acct.version = ACCOUNT_VERSION;
    emit!(AccountCreated {
        owner: acct.owner,
        account: ctx.accounts.account.key(),
        session_key,
        session_expires_at: acct.session_expires_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetSession<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ACCOUNT_SEED, owner.key().as_ref()], bump)]
    pub account: AccountLoader<'info, TradingAccount>,
}

/// Registers (or replaces) the session key. Owner only.
pub fn set_session(ctx: Context<SetSession>, session_key: Pubkey, session_expires_at: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_session(&ctx.accounts.config, &session_key, session_expires_at, now)?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.session_key = session_key;
    acct.session_expires_at = if session_key == Pubkey::default() { 0 } else { session_expires_at };
    emit!(SessionChanged { owner: acct.owner, session_key, session_expires_at: acct.session_expires_at });
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeSession<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub account: AccountLoader<'info, TradingAccount>,
}

/// Removes the session key. The owner or the session key itself may do this.
pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
    let mut acct = ctx.accounts.account.load_mut()?;
    // An expired session may still revoke itself.
    if ctx.accounts.signer.key() != acct.owner {
        require_keys_eq!(ctx.accounts.signer.key(), acct.session_key, ZapError::Unauthorized);
    }
    acct.session_key = Pubkey::default();
    acct.session_expires_at = 0;
    emit!(SessionChanged { owner: acct.owner, session_key: Pubkey::default(), session_expires_at: 0 });
    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ACCOUNT_SEED, owner.key().as_ref()], bump)]
    pub account: AccountLoader<'info, TradingAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,
    #[account(mut, address = config.custody)]
    pub custody: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Moves USDC from the owner's wallet into their trading balance.
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ZapError::ZeroAmount);
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.custody.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.balance = acct.balance.checked_add(amount).ok_or(error!(ZapError::MathOverflow))?;
    acct.deposited = acct.deposited.saturating_add(amount);
    acct.seq += 1;
    emit!(Deposited { owner: acct.owner, amount, balance: acct.balance, account_seq: acct.seq });
    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut, seeds = [ACCOUNT_SEED, owner.key().as_ref()], bump)]
    pub account: AccountLoader<'info, TradingAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,
    #[account(mut, address = config.custody)]
    pub custody: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Moves free USDC from the trading balance back to the owner's wallet. Owner only; always allowed, even when paused.
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ZapError::ZeroAmount);
    {
        let mut acct = ctx.accounts.account.load_mut()?;
        require!(acct.balance >= amount, ZapError::InsufficientBalance);
        acct.balance -= amount;
        acct.withdrawn = acct.withdrawn.saturating_add(amount);
        acct.seq += 1;
        emit!(Withdrawn { owner: acct.owner, amount, balance: acct.balance, account_seq: acct.seq });
    }
    let pool_bump = [ctx.accounts.config.pool_bump];
    let signer: &[&[&[u8]]] = &[&[POOL_SEED, &pool_bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.custody.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.owner_usdc.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )
}

#[derive(Accounts)]
pub struct CloseAccount<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [ACCOUNT_SEED, owner.key().as_ref()], bump, close = rent_payer)]
    pub account: AccountLoader<'info, TradingAccount>,
    /// CHECK: must be the account's recorded rent payer, who gets the rent back.
    #[account(mut, address = account.load()?.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

/// Closes an empty trading account and refunds its rent to whoever paid it.
pub fn close_account(ctx: Context<CloseAccount>) -> Result<()> {
    let acct = ctx.accounts.account.load()?;
    require!(acct.is_empty(), ZapError::AccountNotEmpty);
    emit!(AccountClosed { owner: acct.owner });
    Ok(())
}
