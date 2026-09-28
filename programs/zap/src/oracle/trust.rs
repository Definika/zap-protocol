//! Is the price signer trusted? Either one of the signers in our config (used for the dev oracle and tests), or a
//! signer listed in Pyth Pro's on-chain storage account, each with an expiry.

use anchor_lang::prelude::*;

use crate::constants::{PYTH_PRO_PROGRAM_ID, PYTH_STORAGE_DISCRIMINATOR};
use crate::error::ZapError;
use crate::state::ConfigParams;

// Pyth Pro `Storage` layout (Anchor/Borsh): discriminator(8) | top_authority(32) | treasury(32) | fee(8)
// | num_trusted_signers(1) | 5 × { pubkey(32), expires_at(i64) } | …  (381 bytes in total).
const NUM_SIGNERS_OFFSET: usize = 80;
const SIGNERS_OFFSET: usize = 81;
const SIGNER_ENTRY_LEN: usize = 40;
const MAX_STORAGE_SIGNERS: usize = 5;

pub fn check_signer(params: &ConfigParams, pyth_storage: &AccountInfo, signer: &[u8; 32], now: i64) -> Result<()> {
    let signer = Pubkey::new_from_array(*signer);
    for (key, expiry) in params.oracle_signers.iter().zip(params.oracle_signer_expiry) {
        if *key != Pubkey::default() && *key == signer && expiry > now {
            return Ok(());
        }
    }
    if params.use_pyth_storage {
        require_keys_eq!(pyth_storage.key(), params.pyth_storage, ZapError::BadPythStorage);
        require_keys_eq!(*pyth_storage.owner, PYTH_PRO_PROGRAM_ID, ZapError::BadPythStorage);
        let data = pyth_storage.try_borrow_data()?;
        require!(
            data.len() >= SIGNERS_OFFSET + MAX_STORAGE_SIGNERS * SIGNER_ENTRY_LEN
                && data[..8] == PYTH_STORAGE_DISCRIMINATOR,
            ZapError::BadPythStorage
        );
        let n = usize::from(data[NUM_SIGNERS_OFFSET]);
        require!(n <= MAX_STORAGE_SIGNERS, ZapError::BadPythStorage);
        for i in 0..n {
            let at = SIGNERS_OFFSET + i * SIGNER_ENTRY_LEN;
            let expires_at = i64::from_le_bytes(data[at + 32..at + 40].try_into().unwrap());
            if data[at..at + 32] == signer.to_bytes() && expires_at > now {
                return Ok(());
            }
        }
    }
    err!(ZapError::UntrustedSigner)
}
