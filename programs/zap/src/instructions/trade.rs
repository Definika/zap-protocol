use anchor_lang::prelude::*;
use zap_math::{fees, position as pm, price};

use crate::constants::*;
use crate::error::{MathResultExt, ZapError};
use crate::events::{trade_kind, CollateralChanged, TpslChanged, Trade};
use crate::logic::{accrue, trade};
use crate::oracle::{self, MarketPrice};
use crate::state::{Config, ConfigParams, Market, Pool, TradingAccount};

/// Accounts for instructions that trade at an oracle price. Signed by the account owner or its session key.
#[derive(Accounts)]
pub struct TradeWithPrice<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub account: AccountLoader<'info, TradingAccount>,
    /// CHECK: Pyth Pro storage; checked in `oracle::trust` when signers come from it.
    pub pyth_storage: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (address-checked).
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

/// Accounts for position changes that need no price.
#[derive(Accounts)]
pub struct TradeNoPrice<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub account: AccountLoader<'info, TradingAccount>,
}

fn verified_price(ctx: &Context<TradeWithPrice>, market: &mut Market, params: &ConfigParams, msg: &[u8], now: i64) -> Result<MarketPrice> {
    let prices = oracle::verify(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.pyth_storage.to_account_info(),
        params,
        msg,
        now,
    )?;
    let p = prices.for_market(market, params)?;
    oracle::apply_watermark(market, &p, params.price_grace_ms)?;
    Ok(p)
}

fn position_index(acct: &TradingAccount, market: &Market, side_: u8, position_id: u64) -> Result<usize> {
    let i = acct.find_position(market.index, side_).ok_or(error!(ZapError::PositionNotFound))?;
    require!(acct.positions[i].position_id == position_id, ZapError::IdMismatch);
    Ok(i)
}

/// Removes orders bound to a position that no longer exists (their escrow, if any, returns to the balance).
pub fn cancel_bound_orders(acct: &mut TradingAccount, position_id: u64) {
    let mut refund = 0u64;
    for o in acct.orders.iter_mut() {
        if o.status == slot_status::OPEN && o.position_id == position_id && position_id != 0 {
            refund += o.collateral_escrow + o.fee_escrow;
            *o = Default::default();
        }
    }
    acct.balance += refund;
}

/// Result of opening or adding to a position.
pub struct OpenOutcome {
    pub position_id: u64,
    pub fill_price: u64,
    pub fee: u64,
    pub spread_cost: u64,
    pub impact_cost: u64,
    pub owed: trade::Owed,
    pub size_after: u64,
    pub collateral_after: u64,
}

/// Opens (or adds to) the `side_` position at the oracle price plus spread and impact. Collateral and the open fee come
/// from the free balance. Shared by market orders, limit/stop fills and reverse. The caller refreshes the funding rate.
#[allow(clippy::too_many_arguments)]
pub fn open_at(
    acct: &mut TradingAccount,
    market: &mut Market,
    pool: &mut Pool,
    params: &ConfigParams,
    p: &MarketPrice,
    side_: u8,
    size: u64,
    collateral: u64,
    acceptable_price: u64,
    tp_price: u64,
    sl_price: u64,
    now: i64,
) -> Result<OpenOutcome> {
    require!(!params.paused, ZapError::ProtocolPaused);
    let s = trade::math_side(side_)?;
    require!(size >= params.min_order_usd, ZapError::MinSize);
    require!(collateral > 0, ZapError::ZeroAmount);
    match market.status {
        market_status::ACTIVE => {}
        market_status::REDUCE_ONLY => return err!(ZapError::MarketReduceOnly),
        _ => return err!(ZapError::MarketPaused),
    }
    require!(
        u128::from(p.conf) * 10_000 <= u128::from(p.price) * u128::from(market.params.max_conf_bps),
        ZapError::ConfidenceTooWide
    );

    let is_buy = side_ == side::LONG;
    let f = trade::fill(market, p, size, is_buy)?;
    trade::check_slippage(f.price, acceptable_price, is_buy)?;
    let units = price::units_for(size, f.price, s.is_long()).m()?;
    let fee = fees::open_fee(size, market.params.open_fee_bps).m()?;
    let debit = collateral.checked_add(fee).ok_or(error!(ZapError::MathOverflow))?;
    require!(acct.balance >= debit, ZapError::InsufficientBalance);

    let (i, owed) = match acct.find_position(market.index, side_) {
        Some(i) => {
            require!(p.ts_us >= acct.positions[i].last_price_ts_us, ZapError::BelowPositionTimestamp);
            let o = trade::settle(&mut acct.positions[i], market, pool, params)?;
            (i, o)
        }
        None => {
            let i = acct.free_position_slot()?;
            let id = acct.next_position_id;
            acct.next_position_id += 1;
            let funding = if is_buy { market.funding_index_long } else { market.funding_index_short };
            let pos = &mut acct.positions[i];
            pos.position_id = id;
            pos.market_index = market.index;
            pos.side = side_;
            pos.status = slot_status::OPEN;
            pos.opened_at = now;
            pos.entry_borrow_index = pool.borrow_index;
            pos.entry_funding_index = funding;
            (i, trade::Owed::default())
        }
    };

    trade::add_to_position(&mut acct.positions[i], market, pool, size, units, collateral)?;
    trade::check_open_health(&acct.positions[i], market, p.price)?;
    trade::check_caps(market, pool, params, side_, acct.positions[i].size_usd)?;

    trade::credit_fee(pool, fee, params.protocol_fee_share_bps)?;
    acct.balance -= debit;
    acct.fees_paid = acct.fees_paid.saturating_add(fee);
    acct.borrow_paid = acct.borrow_paid.saturating_add(owed.borrow);
    acct.funding_paid = acct.funding_paid.saturating_add(owed.funding as i64);
    acct.volume = acct.volume.saturating_add(size);
    acct.seq += 1;
    let spread_cost = trade::frac_cost(size, f.spread)?;
    let impact_cost = trade::frac_cost(size, f.impact)?;
    pool.cum_trading_fees = pool.cum_trading_fees.saturating_add(fee);
    pool.cum_spread_impact = pool.cum_spread_impact.saturating_add(spread_cost + impact_cost);
    pool.cum_volume = pool.cum_volume.saturating_add(size);
    market.cum_volume = market.cum_volume.saturating_add(size);
    market.cum_fees = market.cum_fees.saturating_add(fee);
    market.trade_seq += 1;

    let pos = &mut acct.positions[i];
    if tp_price != 0 {
        pos.tp_price = tp_price;
    }
    if sl_price != 0 {
        pos.sl_price = sl_price;
    }
    pos.last_price_ts_us = p.ts_us;
    pos.updated_at = now;
    pos.fees_paid = pos.fees_paid.saturating_add(fee);
    Ok(OpenOutcome {
        position_id: pos.position_id,
        fill_price: f.price,
        fee,
        spread_cost,
        impact_cost,
        owed,
        size_after: pos.size_usd,
        collateral_after: pos.collateral,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn emit_open(
    account: Pubkey,
    acct: &TradingAccount,
    market: &Market,
    pool: &mut Pool,
    side_: u8,
    kind: u8,
    order_id: u64,
    size: u64,
    p: &MarketPrice,
    o: &OpenOutcome,
    now: i64,
) {
    emit!(Trade {
        pool_seq: pool.next_seq(),
        ts: now,
        account,
        owner: acct.owner,
        market: market.index,
        side: side_,
        kind,
        position_id: o.position_id,
        order_id,
        size_delta: size as i64,
        size_after: o.size_after,
        collateral_after: o.collateral_after,
        oracle_price: p.price,
        fill_price: o.fill_price,
        price_ts_us: p.ts_us,
        open_fee: o.fee,
        close_fee: 0,
        spread_cost: o.spread_cost,
        impact_cost: o.impact_cost,
        borrow_paid: o.owed.borrow,
        funding_paid: o.owed.funding as i64,
        pnl: 0,
        payout: 0,
        oi_long_after: market.oi_long,
        oi_short_after: market.oi_short,
    });
}

/// Market order: opens a position or adds to one.
#[allow(clippy::too_many_arguments)]
pub fn open_position(
    ctx: Context<TradeWithPrice>,
    price_msg: Vec<u8>,
    side_: u8,
    size: u64,
    collateral: u64,
    acceptable_price: u64,
    tp_price: u64,
    sl_price: u64,
) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_mut()?;
    let p = verified_price(&ctx, &mut market, &params, &price_msg, now)?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;
    let o = open_at(&mut acct, &mut market, &mut pool, &params, &p, side_, size, collateral, acceptable_price, tp_price, sl_price, now)?;
    accrue::refresh_funding_rate(&mut market, &params)?;
    emit_open(ctx.accounts.account.key(), &acct, &market, &mut pool, side_, trade_kind::OPEN, 0, size, &p, &o, now);
    Ok(())
}

/// Closes the whole position and opens the opposite side with the same size and collateral, at one price.
pub fn reverse_position(
    ctx: Context<TradeWithPrice>,
    price_msg: Vec<u8>,
    side_: u8,
    position_id: u64,
    acceptable_price: u64,
) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_mut()?;
    require!(market.status == market_status::ACTIVE, ZapError::MarketReduceOnly);
    let p = verified_price(&ctx, &mut market, &params, &price_msg, now)?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;

    let i = position_index(&acct, &market, side_, position_id)?;
    let (size, collateral) = (acct.positions[i].size_usd, acct.positions[i].collateral);
    let closed = close_at(&mut acct, i, &mut market, &mut pool, &params, &p, u64::MAX, acceptable_price, now)?;
    emit_close(ctx.accounts.account.key(), &acct, i, &market, &mut pool, side_, trade_kind::CLOSE, position_id, 0, &p, &closed, now);
    let opposite = if side_ == side::LONG { side::SHORT } else { side::LONG };
    // the new position reuses the settled collateral; both legs trade in the same direction, so the same bound applies
    let collateral = collateral.saturating_sub(closed.owed.total().max(0) as u64);
    let o = open_at(&mut acct, &mut market, &mut pool, &params, &p, opposite, size, collateral, acceptable_price, 0, 0, now)?;
    accrue::refresh_funding_rate(&mut market, &params)?;
    emit_open(ctx.accounts.account.key(), &acct, &market, &mut pool, opposite, trade_kind::OPEN, 0, size, &p, &o, now);
    Ok(())
}

/// Result of closing part or all of a position.
pub struct CloseOutcome {
    pub size: u64,
    pub fill_price: u64,
    pub pnl: i128,
    pub close_fee: u64,
    pub payout: u64,
    pub spread_cost: u64,
    pub impact_cost: u64,
    pub owed: trade::Owed,
    pub fully_closed: bool,
}

/// Closes `size` (capped at the position) at the oracle price: settles owed fees, realizes PnL (capped at +100% of
/// the closed size), charges the close fee and credits the payout to the free balance. Shared by market closes and
/// take-profit / stop-loss execution.
#[allow(clippy::too_many_arguments)]
pub fn close_at(
    acct: &mut TradingAccount,
    i: usize,
    market: &mut Market,
    pool: &mut Pool,
    params: &ConfigParams,
    p: &MarketPrice,
    size: u64,
    acceptable_price: u64,
    now: i64,
) -> Result<CloseOutcome> {
    require!(p.ts_us >= acct.positions[i].last_price_ts_us, ZapError::BelowPositionTimestamp);
    let owed = trade::settle(&mut acct.positions[i], market, pool, params)?;
    let pos = &acct.positions[i];
    let s = trade::math_side(pos.side)?;
    let size = size.min(pos.size_usd);
    require!(size > 0, ZapError::ZeroAmount);
    let fully_closed = size == pos.size_usd;
    if !fully_closed {
        require!(pos.size_usd - size >= params.min_order_usd, ZapError::MinSize);
    }
    let (units, collateral) = trade::close_share(pos, size)?;
    let is_buy = pos.side == side::SHORT;
    let f = trade::fill(market, p, size, is_buy)?;
    trade::check_slippage(f.price, acceptable_price, is_buy)?;
    let pnl = pm::pnl(s, size, units, f.price).m()?;
    let close_fee = fees::close_fee(units, f.price, market.params.close_fee_bps).m()?;

    // What the closed part is worth; the fee comes out of it, and a shortfall (bad debt) is the vault's.
    let available = i128::from(collateral) + pnl;
    let fee_taken = i128::from(close_fee).min(available.max(0));
    let payout = (available - fee_taken).max(0);
    let vault_delta = i128::from(collateral) - payout - fee_taken;
    trade::credit_fee(pool, fee_taken as u64, params.protocol_fee_share_bps)?;
    trade::add_assets(pool, vault_delta)?;

    let pos = &mut acct.positions[i];
    trade::remove_from_position(pos, market, pool, size, units)?;
    pos.collateral -= collateral;
    pos.realized_pnl = pos.realized_pnl.saturating_add(pnl as i64);
    pos.fees_paid = pos.fees_paid.saturating_add(fee_taken as u64);
    pos.last_price_ts_us = p.ts_us;
    pos.updated_at = now;
    let position_id = pos.position_id;
    if fully_closed {
        trade::clear_position(pos);
        cancel_bound_orders(acct, position_id);
    }

    acct.balance = acct.balance.checked_add(payout as u64).ok_or(error!(ZapError::MathOverflow))?;
    acct.realized_pnl = acct.realized_pnl.saturating_add(pnl as i64);
    acct.fees_paid = acct.fees_paid.saturating_add(fee_taken as u64);
    acct.borrow_paid = acct.borrow_paid.saturating_add(owed.borrow);
    acct.funding_paid = acct.funding_paid.saturating_add(owed.funding as i64);
    acct.volume = acct.volume.saturating_add(size);
    acct.seq += 1;

    let spread_cost = trade::frac_cost(size, f.spread)?;
    let impact_cost = trade::frac_cost(size, f.impact)?;
    pool.cum_trading_fees = pool.cum_trading_fees.saturating_add(fee_taken as u64);
    pool.cum_spread_impact = pool.cum_spread_impact.saturating_add(spread_cost + impact_cost);
    pool.cum_trader_pnl = pool.cum_trader_pnl.saturating_add(pnl as i64);
    pool.cum_volume = pool.cum_volume.saturating_add(size);
    market.cum_volume = market.cum_volume.saturating_add(size);
    market.cum_fees = market.cum_fees.saturating_add(fee_taken as u64);
    market.trade_seq += 1;

    Ok(CloseOutcome {
        size,
        fill_price: f.price,
        pnl,
        close_fee: fee_taken as u64,
        payout: payout as u64,
        spread_cost,
        impact_cost,
        owed,
        fully_closed,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn emit_close(
    account: Pubkey,
    acct: &TradingAccount,
    i: usize,
    market: &Market,
    pool: &mut Pool,
    side_: u8,
    kind: u8,
    position_id: u64,
    order_id: u64,
    p: &MarketPrice,
    o: &CloseOutcome,
    now: i64,
) {
    let pos = &acct.positions[i];
    let (size_after, collateral_after) = if o.fully_closed { (0, 0) } else { (pos.size_usd, pos.collateral) };
    emit!(Trade {
        pool_seq: pool.next_seq(),
        ts: now,
        account,
        owner: acct.owner,
        market: market.index,
        side: side_,
        kind,
        position_id,
        order_id,
        size_delta: -(o.size as i64),
        size_after,
        collateral_after,
        oracle_price: p.price,
        fill_price: o.fill_price,
        price_ts_us: p.ts_us,
        open_fee: 0,
        close_fee: o.close_fee,
        spread_cost: o.spread_cost,
        impact_cost: o.impact_cost,
        borrow_paid: o.owed.borrow,
        funding_paid: o.owed.funding as i64,
        pnl: o.pnl as i64,
        payout: o.payout,
        oi_long_after: market.oi_long,
        oi_short_after: market.oi_short,
    });
}

/// Market close of `size` (u64::MAX or more than the position closes it fully). Allowed while paused and in
/// reduce-only markets.
pub fn close_position(
    ctx: Context<TradeWithPrice>,
    price_msg: Vec<u8>,
    side_: u8,
    position_id: u64,
    size: u64,
    acceptable_price: u64,
) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_mut()?;
    require!(market.status != market_status::PAUSED, ZapError::MarketPaused);
    let p = verified_price(&ctx, &mut market, &params, &price_msg, now)?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;

    let i = position_index(&acct, &market, side_, position_id)?;
    let o = close_at(&mut acct, i, &mut market, &mut pool, &params, &p, size, acceptable_price, now)?;
    accrue::refresh_funding_rate(&mut market, &params)?;
    emit_close(ctx.accounts.account.key(), &acct, i, &market, &mut pool, side_, trade_kind::CLOSE, position_id, 0, &p, &o, now);
    Ok(())
}

/// Moves free balance into a position's collateral.
pub fn add_collateral(ctx: Context<TradeNoPrice>, side_: u8, position_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ZapError::ZeroAmount);
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_mut()?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    require!(acct.balance >= amount, ZapError::InsufficientBalance);
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;
    let i = position_index(&acct, &market, side_, position_id)?;
    let o = trade::settle(&mut acct.positions[i], &mut market, &mut pool, &params)?;
    acct.positions[i].collateral += amount;
    acct.positions[i].updated_at = now;
    acct.balance -= amount;
    acct.borrow_paid = acct.borrow_paid.saturating_add(o.borrow);
    acct.funding_paid = acct.funding_paid.saturating_add(o.funding as i64);
    acct.seq += 1;
    emit!(CollateralChanged {
        account: ctx.accounts.account.key(),
        market: market.index,
        side: side_,
        position_id,
        delta: amount as i64,
        collateral_after: acct.positions[i].collateral,
        borrow_paid: o.borrow,
        funding_paid: o.funding as i64,
    });
    Ok(())
}

/// Moves collateral back to the free balance. Unrealized profit can't be withdrawn, and the position must stay within
/// max leverage and above maintenance margin at the oracle price.
pub fn remove_collateral(ctx: Context<TradeWithPrice>, price_msg: Vec<u8>, side_: u8, position_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ZapError::ZeroAmount);
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_mut()?;
    let p = verified_price(&ctx, &mut market, &params, &price_msg, now)?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;
    let i = position_index(&acct, &market, side_, position_id)?;
    require!(p.ts_us >= acct.positions[i].last_price_ts_us, ZapError::BelowPositionTimestamp);
    let o = trade::settle(&mut acct.positions[i], &mut market, &mut pool, &params)?;
    let pos = &mut acct.positions[i];
    require!(pos.collateral >= amount, ZapError::InsufficientBalance);
    pos.collateral -= amount;
    trade::check_open_health(pos, &market, p.price)?;
    pos.last_price_ts_us = p.ts_us;
    pos.updated_at = now;
    let collateral_after = pos.collateral;
    acct.balance += amount;
    acct.borrow_paid = acct.borrow_paid.saturating_add(o.borrow);
    acct.funding_paid = acct.funding_paid.saturating_add(o.funding as i64);
    acct.seq += 1;
    emit!(CollateralChanged {
        account: ctx.accounts.account.key(),
        market: market.index,
        side: side_,
        position_id,
        delta: -(amount as i64),
        collateral_after,
        borrow_paid: o.borrow,
        funding_paid: o.funding as i64,
    });
    Ok(())
}

/// Sets a position's take-profit and stop-loss trigger prices (0 clears one). Keepers execute them at the oracle price.
pub fn set_tpsl(ctx: Context<TradeNoPrice>, side_: u8, position_id: u64, tp_price: u64, sl_price: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = ctx.accounts.market.load()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    let i = position_index(&acct, &market, side_, position_id)?;
    acct.positions[i].tp_price = tp_price;
    acct.positions[i].sl_price = sl_price;
    acct.positions[i].updated_at = now;
    emit!(TpslChanged {
        account: ctx.accounts.account.key(),
        market: market.index,
        side: side_,
        position_id,
        tp_price,
        sl_price,
    });
    Ok(())
}
