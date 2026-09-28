use anchor_lang::prelude::*;
use zap_math::fees;

use super::trade::{close_at, emit_close, emit_open, open_at};
use crate::constants::*;
use crate::error::{MathResultExt, ZapError};
use crate::events::trade_kind;
use crate::logic::accrue;
use crate::oracle;
use crate::state::{Config, Market, Order, Pool, TradingAccount};

#[event]
pub struct OrderPlaced {
    pub account: Pubkey,
    pub order_id: u64,
    pub market: u16,
    pub side: u8,
    pub kind: u8,
    pub flags: u8,
    pub position_id: u64,
    pub size_usd: u64,
    pub collateral: u64,
    pub trigger_price: u64,
    pub acceptable_price: u64,
}

#[event]
pub struct OrderUpdated {
    pub account: Pubkey,
    pub order_id: u64,
    pub trigger_price: u64,
    pub acceptable_price: u64,
}

#[event]
pub struct OrderCancelled {
    pub account: Pubkey,
    pub order_id: u64,
    pub refund: u64,
}

/// What an order's trigger means for the oracle (mid) price.
pub fn triggered(kind: u8, side_: u8, trigger: u64, mid: u64) -> bool {
    let long = side_ == side::LONG;
    match kind {
        // buy at or below / sell at or above
        order_kind::LIMIT => if long { mid <= trigger } else { mid >= trigger },
        // buy on a break above / sell on a break below
        order_kind::STOP => if long { mid >= trigger } else { mid <= trigger },
        // a long takes profit above, a short below
        order_kind::TAKE_PROFIT => if long { mid >= trigger } else { mid <= trigger },
        // a long stops out below, a short above
        order_kind::STOP_LOSS => if long { mid <= trigger } else { mid >= trigger },
        _ => false,
    }
}

#[derive(Accounts)]
pub struct ManageOrder<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub account: AccountLoader<'info, TradingAccount>,
}

/// Places a resting order. Opening orders (limit, stop) escrow their collateral and open fee; reduce orders
/// (take-profit, stop-loss; or limit/stop with the reduce-only flag) are bound to an existing position and escrow nothing.
#[allow(clippy::too_many_arguments)]
pub fn place_order(
    ctx: Context<ManageOrder>,
    side_: u8,
    kind: u8,
    flags: u8,
    position_id: u64,
    size_usd: u64,
    collateral: u64,
    trigger_price: u64,
    acceptable_price: u64,
    tp_price: u64,
    sl_price: u64,
) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let market = ctx.accounts.market.load()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    require!(side_ <= side::SHORT && trigger_price > 0, ZapError::InvalidParams);
    require!((order_kind::LIMIT..=order_kind::STOP_LOSS).contains(&kind), ZapError::InvalidParams);

    // Reduce-only limit/stop orders behave as take-profit/stop-loss on the position.
    let reduce = flags & order_flags::REDUCE_ONLY != 0 || kind >= order_kind::TAKE_PROFIT;
    let kind = match (reduce, kind) {
        (true, order_kind::LIMIT) => order_kind::TAKE_PROFIT,
        (true, order_kind::STOP) => order_kind::STOP_LOSS,
        _ => kind,
    };

    let (collateral_escrow, fee_escrow, size_usd, position_id) = if reduce {
        let i = acct.find_position(market.index, side_).ok_or(error!(ZapError::PositionNotFound))?;
        require!(acct.positions[i].position_id == position_id, ZapError::IdMismatch);
        require!(size_usd > 0, ZapError::ZeroAmount);
        (0, 0, size_usd, position_id)
    } else {
        require!(!params.paused, ZapError::ProtocolPaused);
        require!(market.status == market_status::ACTIVE, ZapError::MarketReduceOnly);
        require!(size_usd >= params.min_order_usd, ZapError::MinSize);
        require!(collateral > 0, ZapError::ZeroAmount);
        require!(
            zap_math::position::leverage_ok(size_usd, collateral, market.params.max_leverage),
            ZapError::MaxLeverage
        );
        if flags & order_flags::POST_ONLY != 0 && market.last_price != 0 {
            require!(!triggered(kind, side_, trigger_price, market.last_price), ZapError::PostOnlyWouldFill);
        }
        let fee = fees::open_fee(size_usd, market.params.open_fee_bps).m()?;
        let escrow = collateral.checked_add(fee).ok_or(error!(ZapError::MathOverflow))?;
        require!(acct.balance >= escrow, ZapError::InsufficientBalance);
        acct.balance -= escrow;
        (collateral, fee, size_usd, 0)
    };

    let slot = acct.free_order_slot()?;
    let order_id = acct.next_order_id;
    acct.next_order_id += 1;
    acct.seq += 1;
    acct.orders[slot] = Order {
        order_id,
        position_id,
        size_usd,
        collateral_escrow,
        fee_escrow,
        trigger_price,
        acceptable_price,
        created_at: now,
        tp_price,
        sl_price,
        market_index: market.index,
        kind,
        side: side_,
        flags: flags & (order_flags::REDUCE_ONLY | order_flags::POST_ONLY),
        status: slot_status::OPEN,
        _pad: [0; 2],
    };
    emit!(OrderPlaced {
        account: ctx.accounts.account.key(),
        order_id,
        market: market.index,
        side: side_,
        kind,
        flags,
        position_id,
        size_usd,
        collateral: collateral_escrow,
        trigger_price,
        acceptable_price,
    });
    Ok(())
}

/// Moves an order's trigger (dragging its line on the chart) and acceptable price.
pub fn update_order(ctx: Context<ManageOrder>, order_id: u64, trigger_price: u64, acceptable_price: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    require!(trigger_price > 0, ZapError::InvalidParams);
    let i = acct.find_order(order_id).ok_or(error!(ZapError::IdMismatch))?;
    acct.orders[i].trigger_price = trigger_price;
    acct.orders[i].acceptable_price = acceptable_price;
    // an updated order may only fill at prices published after the update
    acct.orders[i].created_at = now;
    acct.seq += 1;
    emit!(OrderUpdated { account: ctx.accounts.account.key(), order_id, trigger_price, acceptable_price });
    Ok(())
}

/// Cancels an order and returns its escrow to the free balance.
pub fn cancel_order(ctx: Context<ManageOrder>, order_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    let i = acct.find_order(order_id).ok_or(error!(ZapError::IdMismatch))?;
    let refund = acct.orders[i].collateral_escrow + acct.orders[i].fee_escrow;
    acct.orders[i] = Order::default();
    acct.balance += refund;
    acct.seq += 1;
    emit!(OrderCancelled { account: ctx.accounts.account.key(), order_id, refund });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteTrigger<'info> {
    /// Anyone (in practice, the keeper). Pays only the transaction fee.
    pub executor: Signer<'info>,
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

pub mod trigger_target {
    /// A resting order, by order id.
    pub const ORDER: u8 = 0;
    /// A position's take-profit price, by position id.
    pub const POSITION_TP: u8 = 1;
    /// A position's stop-loss price, by position id.
    pub const POSITION_SL: u8 = 2;
}

/// Permissionless: executes a triggered order or a position's TP/SL at the signed oracle price. The price must be
/// published after the order was placed (or last updated). Limit orders fill only at their limit or better.
pub fn execute_trigger(ctx: Context<ExecuteTrigger>, price_msg: Vec<u8>, target: u8, side_: u8, id: u64) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mut market = ctx.accounts.market.load_mut()?;
    let prices = oracle::verify(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.pyth_storage.to_account_info(),
        &params,
        &price_msg,
        now,
    )?;
    let p = prices.for_market(&market, &params)?;
    oracle::apply_watermark(&mut market, &p, params.price_grace_ms)?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;
    let key = ctx.accounts.account.key();

    if target == trigger_target::ORDER {
        let oi = acct.find_order(id).ok_or(error!(ZapError::IdMismatch))?;
        let o = acct.orders[oi];
        require!(o.market_index == market.index, ZapError::WrongMarket);
        require!(p.ts_us >= (o.created_at as u64) * 1_000_000, ZapError::BelowPositionTimestamp);
        require!(triggered(o.kind, o.side, o.trigger_price, p.price), ZapError::TriggerNotMet);
        acct.orders[oi] = Order::default();

        if o.kind == order_kind::LIMIT || o.kind == order_kind::STOP {
            // Release the escrow and open with it. A limit order's limit is also its worst fill price.
            acct.balance += o.collateral_escrow + o.fee_escrow;
            let bound = if o.kind == order_kind::LIMIT { o.trigger_price } else { o.acceptable_price };
            let out = open_at(
                &mut acct, &mut market, &mut pool, &params, &p, o.side, o.size_usd, o.collateral_escrow, bound,
                o.tp_price, o.sl_price, now,
            )?;
            let kind = if o.kind == order_kind::LIMIT { trade_kind::LIMIT_FILL } else { trade_kind::STOP_FILL };
            accrue::refresh_funding_rate(&mut market, &params)?;
            emit_open(key, &acct, &market, &mut pool, o.side, kind, o.order_id, o.size_usd, &p, &out, now);
        } else {
            let pi = acct.find_position(market.index, o.side).ok_or(error!(ZapError::PositionNotFound))?;
            require!(acct.positions[pi].position_id == o.position_id, ZapError::IdMismatch);
            let out = close_at(&mut acct, pi, &mut market, &mut pool, &params, &p, o.size_usd, o.acceptable_price, now)?;
            let kind = if o.kind == order_kind::TAKE_PROFIT { trade_kind::TAKE_PROFIT } else { trade_kind::STOP_LOSS };
            accrue::refresh_funding_rate(&mut market, &params)?;
            emit_close(key, &acct, pi, &market, &mut pool, o.side, kind, o.position_id, o.order_id, &p, &out, now);
        }
    } else {
        let pi = acct.find_position(market.index, side_).ok_or(error!(ZapError::PositionNotFound))?;
        let pos = acct.positions[pi];
        require!(pos.position_id == id, ZapError::IdMismatch);
        let (kind, trigger, tk) = match target {
            trigger_target::POSITION_TP => (order_kind::TAKE_PROFIT, pos.tp_price, trade_kind::TAKE_PROFIT),
            trigger_target::POSITION_SL => (order_kind::STOP_LOSS, pos.sl_price, trade_kind::STOP_LOSS),
            _ => return err!(ZapError::InvalidParams),
        };
        require!(trigger != 0 && triggered(kind, side_, trigger, p.price), ZapError::TriggerNotMet);
        let out = close_at(&mut acct, pi, &mut market, &mut pool, &params, &p, u64::MAX, 0, now)?;
        accrue::refresh_funding_rate(&mut market, &params)?;
        emit_close(key, &acct, pi, &market, &mut pool, side_, tk, id, 0, &p, &out, now);
    }
    Ok(())
}
