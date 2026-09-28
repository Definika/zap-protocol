//! Checks that the ed25519 precompile verified exactly the price message this instruction received.
//!
//! The precompile instruction must sit directly before ours, verify one signature, and point all of its offsets into
//! our instruction data, where the price message is always the first argument. We then compare our instruction's data
//! with the message we parse, which also rejects calls through CPI (the top-level instruction would differ).

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use super::pyth_pro::ENVELOPE_HEADER_LEN;
use crate::error::ZapError;

/// Where the price message starts in our instruction data: 8-byte discriminator + 4-byte Vec length.
pub const MESSAGE_OFFSET: u16 = 12;
/// ed25519 precompile instruction: count(1) + padding(1) + 7 × u16 offsets.
pub const ED25519_IX_LEN: usize = 16;

pub fn verify_signed_message(instructions: &AccountInfo, price_msg: &[u8]) -> Result<()> {
    let current = load_current_index_checked(instructions)?;
    require!(current > 0, ZapError::Ed25519Missing);
    let ed = load_instruction_at_checked(usize::from(current - 1), instructions)?;
    require_keys_eq!(ed.program_id, solana_sdk_ids::ed25519_program::ID, ZapError::Ed25519Missing);

    let d = &ed.data;
    require!(d.len() == ED25519_IX_LEN && d[0] == 1, ZapError::Ed25519Offsets);
    let at = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]);
    let (sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_size, msg_ix) =
        (at(2), at(4), at(6), at(8), at(10), at(12), at(14));
    require!(sig_ix == current && pk_ix == current && msg_ix == current, ZapError::Ed25519Offsets);
    require!(
        sig_off == MESSAGE_OFFSET + 4
            && pk_off == MESSAGE_OFFSET + 4 + 64
            && msg_off == MESSAGE_OFFSET + ENVELOPE_HEADER_LEN as u16,
        ZapError::Ed25519Offsets
    );
    require!(price_msg.len() >= ENVELOPE_HEADER_LEN, ZapError::MalformedPriceMessage);
    let payload_len = u16::from_le_bytes([price_msg[100], price_msg[101]]);
    require!(
        msg_size == payload_len && price_msg.len() == ENVELOPE_HEADER_LEN + usize::from(payload_len),
        ZapError::Ed25519Offsets
    );

    let own = load_instruction_at_checked(usize::from(current), instructions)?;
    require_keys_eq!(own.program_id, crate::ID, ZapError::MessageMismatch);
    let start = usize::from(MESSAGE_OFFSET);
    require!(own.data.get(start..start + price_msg.len()) == Some(price_msg), ZapError::MessageMismatch);
    Ok(())
}
