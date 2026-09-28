//! LiteSVM test harness: program setup, USDC mint and token accounts, instruction builders, and signed Pyth Pro
//! price messages (from a test signer, or the real vector from Pyth's own test suite).

#![allow(dead_code)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

use zap::constants::*;
use zap::oracle::ed25519::MESSAGE_OFFSET;
use zap::oracle::pyth_pro::{PAYLOAD_FORMAT_MAGIC, SOLANA_FORMAT_MAGIC};
use zap::state::{ConfigParams, Market, MarketParams, Pool, TradingAccount};

pub const USD: u64 = 1_000_000;
/// Unix time of the real Pyth vector (2026-02-17); tests run with the clock set here.
pub const T0: i64 = 1_771_339_368;
pub const BTC_FEED: u32 = 1;
pub const SOL_FEED: u32 = 6;

pub type TxResult = core::result::Result<TransactionMetadata, FailedTransactionMetadata>;

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &zap::ID).0
}
pub fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}
pub fn pool_pda() -> Pubkey {
    pda(&[POOL_SEED])
}
pub fn custody_pda() -> Pubkey {
    pda(&[CUSTODY_SEED])
}
pub fn market_pda(index: u16) -> Pubkey {
    pda(&[MARKET_SEED, &index.to_le_bytes()])
}
pub fn account_pda(owner: &Pubkey) -> Pubkey {
    pda(&[ACCOUNT_SEED, owner.as_ref()])
}

pub fn symbol(s: &str) -> [u8; 16] {
    let mut out = [0u8; 16];
    out[..s.len()].copy_from_slice(s.as_bytes());
    out
}

pub fn default_params(oracle: Pubkey) -> ConfigParams {
    ConfigParams {
        pyth_storage: Pubkey::default(),
        oracle_signers: [oracle, Pubkey::default()],
        oracle_signer_expiry: [i64::MAX, 0],
        use_pyth_storage: false,
        required_channel: 3,
        max_price_age_s: 5,
        max_future_s: 5,
        max_feed_age_s: 10,
        price_grace_ms: 1_000,
        min_order_usd: 10 * USD,
        max_util_bps: 8_000,
        liq_fee_bps: 20,
        liquidator_share_bps: 5_000,
        protocol_fee_share_bps: 0,
        borrow_kink_util_bps: 7_500,
        borrow_kink_apr_bps: 3_000,
        borrow_max_apr_bps: 10_000,
        funding_max_hourly: 100_000_000_000_000,
        session_max_secs: 30 * 86_400,
        lp_fee_bps: 0,
        lp_cooldown_s: 0,
        paused: false,
        lp_paused: false,
    }
}

/// Tier A (BTC/ETH) parameters from config/markets.json.
pub fn tier_a() -> MarketParams {
    MarketParams {
        max_leverage: 100,
        mmr_bps: 50,
        open_fee_bps: 4,
        close_fee_bps: 4,
        conf_mult_bps: 10_000,
        max_conf_bps: 50,
        impact_cap_bps: 50,
        oi_cap_long_bps: 1_500,
        oi_cap_short_bps: 1_500,
        _pad: [0; 6],
        min_spread_frac: 50_000_000,
        impact_depth_usd: 500_000_000 * USD,
        max_position_usd: 250_000 * USD,
    }
}

// SPL Token account layouts, written directly so tests don't need mint/transfer instructions.
pub fn mint_data(authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = decimals;
    d[45] = 1; // initialized
    d
}

pub fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

pub fn token_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub relayer: Keypair,
    pub oracle: Keypair,
    pub mint: Pubkey,
}

impl Env {
    /// Program deployed, clock at T0, config initialized with `oracle` as a trusted signer.
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(zap::ID, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/zap.so")))
            .unwrap();
        let admin = Keypair::new();
        let relayer = Keypair::new();
        let oracle = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
        svm.airdrop(&relayer.pubkey(), 100_000_000_000).unwrap();
        let mint = Pubkey::new_unique();
        let rent = svm.minimum_balance_for_rent_exemption(82);
        svm.set_account(
            mint,
            Account {
                lamports: rent,
                data: mint_data(&admin.pubkey(), 6),
                owner: anchor_spl::token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        let mut env = Env { svm, admin, relayer, oracle, mint };
        env.set_time(T0);
        let params = default_params(env.oracle.pubkey());
        env.initialize(params).unwrap();
        env
    }

    pub fn set_time(&mut self, unix: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    /// Sends a transaction paid by `payer`, signed by `payer` and `signers`.
    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> TxResult {
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
        let mut all: Vec<&Keypair> = vec![payer];
        for s in signers {
            if !all.iter().any(|k| k.pubkey() == s.pubkey()) {
                all.push(s);
            }
        }
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    pub fn token_account(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let key = Pubkey::new_unique();
        let rent = self.svm.minimum_balance_for_rent_exemption(165);
        self.svm
            .set_account(
                key,
                Account {
                    lamports: rent,
                    data: token_account_data(&self.mint, owner, amount),
                    owner: anchor_spl::token::ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        key
    }

    pub fn balance_of(&self, token_account: &Pubkey) -> u64 {
        token_amount(&self.svm.get_account(token_account).unwrap().data)
    }

    pub fn zero_copy<T: bytemuck::Pod>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).expect("account exists");
        bytemuck::pod_read_unaligned(&acc.data[8..8 + core::mem::size_of::<T>()])
    }

    pub fn pool(&self) -> Pool {
        self.zero_copy(&pool_pda())
    }
    pub fn market(&self, index: u16) -> Market {
        self.zero_copy(&market_pda(index))
    }
    pub fn trading_account(&self, owner: &Pubkey) -> TradingAccount {
        self.zero_copy(&account_pda(owner))
    }

    // Instructions

    pub fn initialize(&mut self, params: ConfigParams) -> TxResult {
        let ix = Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::Initialize { params }.data(),
            zap::accounts::Initialize {
                admin: self.admin.pubkey(),
                config: config_pda(),
                pool: pool_pda(),
                usdc_mint: self.mint,
                custody: custody_pda(),
                token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        );
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &admin, &[])
    }

    pub fn update_config(&mut self, params: ConfigParams) -> TxResult {
        let ix = Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::UpdateConfig { params }.data(),
            zap::accounts::UpdateConfig { admin: self.admin.pubkey(), config: config_pda(), pool: pool_pda() }
                .to_account_metas(None),
        );
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &admin, &[])
    }

    pub fn add_market(&mut self, index: u16, feed_id: u32, name: &str, params: MarketParams) -> TxResult {
        let ix = Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::AddMarket { index, feed_id, expo: -8, symbol: symbol(name), params }.data(),
            zap::accounts::AddMarket {
                admin: self.admin.pubkey(),
                config: config_pda(),
                pool: pool_pda(),
                market: market_pda(index),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        );
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &admin, &[])
    }

    pub fn create_account_ix(&self, owner: &Pubkey, session: Pubkey, expires: i64) -> Instruction {
        Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::CreateAccount { session_key: session, session_expires_at: expires }.data(),
            zap::accounts::CreateAccount {
                owner: *owner,
                rent_payer: self.relayer.pubkey(),
                config: config_pda(),
                account: account_pda(owner),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn deposit_ix(&self, owner: &Pubkey, owner_usdc: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::Deposit { amount }.data(),
            zap::accounts::Deposit {
                owner: *owner,
                config: config_pda(),
                account: account_pda(owner),
                owner_usdc: *owner_usdc,
                custody: custody_pda(),
                usdc_mint: self.mint,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn withdraw_ix(&self, owner: &Pubkey, owner_usdc: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::Withdraw { amount }.data(),
            zap::accounts::Withdraw {
                owner: *owner,
                config: config_pda(),
                pool: pool_pda(),
                account: account_pda(owner),
                owner_usdc: *owner_usdc,
                custody: custody_pda(),
                usdc_mint: self.mint,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    }

    /// `[ed25519 verify, refresh_markets]` for the given markets and signed message.
    pub fn refresh_ixs(&self, markets: &[u16], msg: &[u8], pyth_storage: Pubkey) -> Vec<Instruction> {
        let mut metas = zap::accounts::RefreshMarkets {
            config: config_pda(),
            pool: pool_pda(),
            pyth_storage,
            instructions: solana_sdk_ids::sysvar::instructions::ID,
        }
        .to_account_metas(None);
        metas.extend(markets.iter().map(|&i| AccountMeta::new(market_pda(i), false)));
        let ix = Instruction::new_with_bytes(
            zap::ID,
            &zap::instruction::RefreshMarkets { price_msg: msg.to_vec() }.data(),
            metas,
        );
        vec![ed25519_ix(msg, 1), ix]
    }

    /// A trader with a funded wallet token account and a trading account (optionally with a session key).
    pub fn trader(&mut self, wallet_usdc: u64, session: Option<&Keypair>) -> (Keypair, Pubkey) {
        let owner = Keypair::new();
        self.svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();
        let usdc = self.token_account(&owner.pubkey(), wallet_usdc);
        let (session_key, expires) = match session {
            Some(s) => (s.pubkey(), self.now() + 86_400),
            None => (Pubkey::default(), 0),
        };
        let ix = self.create_account_ix(&owner.pubkey(), session_key, expires);
        let relayer = self.relayer.insecure_clone();
        self.send(&[ix], &relayer, &[&owner]).unwrap();
        (owner, usdc)
    }
}

/// ed25519 precompile instruction verifying the signed message that sits at `MESSAGE_OFFSET` in instruction `ix_index`.
pub fn ed25519_ix(msg: &[u8], ix_index: u16) -> Instruction {
    let payload_len = u16::from_le_bytes([msg[100], msg[101]]);
    let sig = MESSAGE_OFFSET + 4;
    let mut data = vec![1u8, 0];
    for v in [sig, ix_index, sig + 64, ix_index, sig + 64 + 32 + 2, payload_len, ix_index] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    Instruction { program_id: solana_sdk_ids::ed25519_program::ID, accounts: vec![], data }
}

/// One feed in a test price message.
#[derive(Clone, Copy)]
pub struct TestFeed {
    pub feed_id: u32,
    /// Mantissa with exponent -8.
    pub price: i64,
    pub conf: i64,
    pub feed_ts_us: u64,
}

pub fn feed(feed_id: u32, price_usd: f64, ts_us: u64) -> TestFeed {
    TestFeed { feed_id, price: (price_usd * 1e8).round() as i64, conf: 0, feed_ts_us: ts_us }
}

/// Builds and signs a Pyth Pro Solana-format message with price, exponent (-8), confidence and feed-update timestamp.
pub fn signed_message(signer: &Keypair, ts_us: u64, channel: u8, feeds: &[TestFeed]) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&PAYLOAD_FORMAT_MAGIC.to_le_bytes());
    p.extend_from_slice(&ts_us.to_le_bytes());
    p.push(channel);
    p.push(feeds.len() as u8);
    for f in feeds {
        p.extend_from_slice(&f.feed_id.to_le_bytes());
        p.push(4);
        p.push(0);
        p.extend_from_slice(&f.price.to_le_bytes());
        p.push(4);
        p.extend_from_slice(&(-8i16).to_le_bytes());
        p.push(5);
        p.extend_from_slice(&f.conf.to_le_bytes());
        p.push(12);
        p.push(1);
        p.extend_from_slice(&f.feed_ts_us.to_le_bytes());
    }
    let sig = signer.sign_message(&p);
    let mut m = Vec::new();
    m.extend_from_slice(&SOLANA_FORMAT_MAGIC.to_le_bytes());
    m.extend_from_slice(sig.as_ref());
    m.extend_from_slice(signer.pubkey().as_ref());
    m.extend_from_slice(&(p.len() as u16).to_le_bytes());
    m.extend_from_slice(&p);
    m
}

pub fn us(unix: i64) -> u64 {
    (unix as u64) * 1_000_000
}

/// Asserts a transaction failed with a given program error.
pub fn assert_error(res: TxResult, err: zap::error::ZapError) {
    let code = anchor_lang::error::ERROR_CODE_OFFSET + err as u32;
    match res {
        Ok(_) => panic!("expected error {err:?} ({code}), transaction succeeded"),
        Err(e) => {
            let s = format!("{:?}", e.err);
            assert!(s.contains(&format!("Custom({code})")), "expected {err:?} ({code}), got {s}\nlogs: {:#?}", e.meta.logs);
        }
    }
}

/// Asserts a transaction failed (for runtime-level failures such as a bad signature).
pub fn assert_failed(res: TxResult) -> String {
    match res {
        Ok(_) => panic!("expected failure, transaction succeeded"),
        Err(e) => format!("{:?}", e.err),
    }
}
