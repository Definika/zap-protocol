use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::logic::accrue;
use crate::error::ZapError;
use crate::events::{ConfigUpdated, MarketListed, MarketUpdated};
use crate::state::{Config, ConfigParams, Market, MarketParams, Pool};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = Pool::SIZE, seeds = [POOL_SEED], bump)]
    pub pool: AccountLoader<'info, Pool>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [CUSTODY_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub custody: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
    params.validate()?;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.custody = ctx.accounts.custody.key();
    config.bump = ctx.bumps.config;
    config.pool_bump = ctx.bumps.pool;
    config.custody_bump = ctx.bumps.custody;
    config.params = params;

    let mut pool = ctx.accounts.pool.load_init()?;
    pool.bump = ctx.bumps.pool;
    pool.borrow_last_ts = Clock::get()?.unix_timestamp;

    emit!(ConfigUpdated { admin: config.admin, params });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
}

pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
    params.validate()?;
    // Borrow accrued so far uses the old curve.
    let now = Clock::get()?.unix_timestamp;
    accrue::accrue_borrow(&mut *ctx.accounts.pool.load_mut()?, &ctx.accounts.config.params, now)?;
    let config = &mut ctx.accounts.config;
    config.params = params;
    emit!(ConfigUpdated { admin: config.admin, params });
    Ok(())
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct AddMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(init, payer = admin, space = Market::SIZE, seeds = [MARKET_SEED, &index.to_le_bytes()], bump)]
    pub market: AccountLoader<'info, Market>,
    pub system_program: Program<'info, System>,
}

pub fn add_market(
    ctx: Context<AddMarket>,
    index: u16,
    feed_id: u32,
    expo: i16,
    symbol: [u8; 16],
    params: MarketParams,
) -> Result<()> {
    params.validate()?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    require!(index == pool.num_markets, ZapError::InvalidParams);
    require!(index < MAX_MARKETS, ZapError::TooManyMarkets);
    require!(feed_id > 0 && (-18..=0).contains(&expo), ZapError::InvalidParams);
    pool.num_markets += 1;

    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_init()?;
    market.index = index;
    market.status = market_status::ACTIVE;
    market.bump = ctx.bumps.market;
    market.feed_id = feed_id;
    market.expo = expo;
    market.symbol = symbol;
    market.params = params;
    market.last_accrual_ts = now;

    emit!(MarketListed { index, feed_id, expo, symbol, params });
    Ok(())
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct UpdateMarket<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [MARKET_SEED, &index.to_le_bytes()], bump)]
    pub market: AccountLoader<'info, Market>,
}

/// Updates risk and fee parameters. The feed and exponent are fixed at listing.
pub fn update_market(ctx: Context<UpdateMarket>, _index: u16, params: MarketParams) -> Result<()> {
    params.validate()?;
    let mut market = ctx.accounts.market.load_mut()?;
    market.params = params;
    emit!(MarketUpdated { index: market.index, status: market.status, params });
    Ok(())
}

pub fn set_market_status(ctx: Context<UpdateMarket>, _index: u16, status: u8) -> Result<()> {
    require!(status <= market_status::PAUSED, ZapError::InvalidParams);
    let mut market = ctx.accounts.market.load_mut()?;
    market.status = status;
    emit!(MarketUpdated { index: market.index, status, params: market.params });
    Ok(())
}
