mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use zap::error::ZapError;

#[test]
fn initialize_and_list_markets() {
    let mut env = Env::new();
    env.add_market(0, BTC_FEED, "BTC-USD", tier_a()).unwrap();
    env.add_market(1, SOL_FEED, "SOL-USD", tier_a()).unwrap();
    assert_eq!(env.pool().num_markets, 2);
    let m = env.market(1);
    assert_eq!(m.feed_id, SOL_FEED);
    assert_eq!(m.expo, -8);
    assert_eq!(m.symbol_str(), "SOL-USD");
    // index must be the next free one
    assert_error(env.add_market(5, BTC_FEED, "ETH-USD", tier_a()), ZapError::InvalidParams);
    // leverage too high for the maintenance margin plus fees
    let mut bad = tier_a();
    bad.max_leverage = 200;
    assert_error(env.add_market(2, BTC_FEED, "BAD-USD", bad), ZapError::InvalidParams);
}

#[test]
fn deposit_and_withdraw() {
    let mut env = Env::new();
    let (owner, usdc) = env.trader(1_000 * USD, None);
    let ix = env.deposit_ix(&owner.pubkey(), &usdc, 400 * USD);
    let relayer = env.relayer.insecure_clone();
    env.send(&[ix], &relayer, &[&owner]).unwrap();
    assert_eq!(env.trading_account(&owner.pubkey()).balance, 400 * USD);
    assert_eq!(env.balance_of(&usdc), 600 * USD);
    assert_eq!(env.balance_of(&custody_pda()), 400 * USD);

    let ix = env.withdraw_ix(&owner.pubkey(), &usdc, 150 * USD);
    env.send(&[ix], &relayer, &[&owner]).unwrap();
    let acct = env.trading_account(&owner.pubkey());
    assert_eq!((acct.balance, acct.deposited, acct.withdrawn), (250 * USD, 400 * USD, 150 * USD));
    assert_eq!(env.balance_of(&usdc), 750 * USD);
    assert_eq!(env.balance_of(&custody_pda()), 250 * USD);

    let ix = env.withdraw_ix(&owner.pubkey(), &usdc, 251 * USD);
    assert_error(env.send(&[ix], &relayer, &[&owner]), ZapError::InsufficientBalance);
    let ix = env.deposit_ix(&owner.pubkey(), &usdc, 0);
    assert_error(env.send(&[ix], &relayer, &[&owner]), ZapError::ZeroAmount);
}

#[test]
fn session_key_cannot_withdraw() {
    let mut env = Env::new();
    let session = Keypair::new();
    let (owner, usdc) = env.trader(1_000 * USD, Some(&session));
    let relayer = env.relayer.insecure_clone();
    env.send(&[env.deposit_ix(&owner.pubkey(), &usdc, 500 * USD)], &relayer, &[&owner]).unwrap();
    let acct = env.trading_account(&owner.pubkey());
    assert_eq!(acct.session_key, session.pubkey());
    assert!(acct.session_expires_at > env.now());

    // The session key signs in the owner's place: the account address no longer matches its seeds.
    let mut ix = env.withdraw_ix(&owner.pubkey(), &usdc, 100 * USD);
    ix.accounts[0].pubkey = session.pubkey();
    assert!(env.send(&[ix], &relayer, &[&session]).is_err());
    assert_eq!(env.trading_account(&owner.pubkey()).balance, 500 * USD);
}

#[test]
fn session_expiry_is_bounded() {
    let mut env = Env::new();
    let owner = Keypair::new();
    let relayer = env.relayer.insecure_clone();
    let too_long = env.now() + 31 * 86_400;
    let ix = env.create_account_ix(&owner.pubkey(), Pubkey::new_unique(), too_long);
    assert_error(env.send(&[ix], &relayer, &[&owner]), ZapError::InvalidSessionExpiry);
    let in_past = env.now() - 1;
    let ix = env.create_account_ix(&owner.pubkey(), Pubkey::new_unique(), in_past);
    assert_error(env.send(&[ix], &relayer, &[&owner]), ZapError::InvalidSessionExpiry);
}

#[test]
fn relayer_pays_rent_and_gets_it_back() {
    let mut env = Env::new();
    let before = env.svm.get_balance(&env.relayer.pubkey()).unwrap();
    let (owner, _) = env.trader(0, None);
    let paid = before - env.svm.get_balance(&env.relayer.pubkey()).unwrap();
    assert!(paid > 30_000_000, "rent for the trading account should come from the relayer, paid {paid}");

    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        zap::ID,
        &anchor_lang::InstructionData::data(&zap::instruction::CloseAccount {}),
        anchor_lang::ToAccountMetas::to_account_metas(
            &zap::accounts::CloseAccount {
                owner: owner.pubkey(),
                account: account_pda(&owner.pubkey()),
                rent_payer: env.relayer.pubkey(),
            },
            None,
        ),
    );
    let relayer = env.relayer.insecure_clone();
    env.send(&[ix], &relayer, &[&owner]).unwrap();
    let after = env.svm.get_balance(&env.relayer.pubkey()).unwrap();
    // only transaction fees are lost
    assert!(before - after < 50_000, "relayer lost {} lamports", before - after);
    assert!(env.svm.get_account(&account_pda(&owner.pubkey())).map_or(true, |a| a.lamports == 0));
}
