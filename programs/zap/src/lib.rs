//! ZAP Protocol: oracle-priced perpetual futures on Solana.
//!
//! A single USDC vault is the counterparty to every trade. Fills happen at Pyth Pro signed prices carried in the same
//! transaction. See `crates/zap-math` for the pricing, fee, funding and liquidation math.

use anchor_lang::prelude::*;

declare_id!("H7YEstzQnFYuAkSXgPLe1YrL5WoUvgvo4cyndrQsgcwi");

#[program]
pub mod zap {}
