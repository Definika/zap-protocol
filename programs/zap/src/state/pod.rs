use anchor_lang::prelude::*;

// 128-bit integers stored as byte arrays: u128/i128 alignment differs between the host and the SBF target, which would
// give zero-copy accounts different layouts in tests and on-chain.

#[zero_copy]
#[derive(Default, Debug, PartialEq, Eq)]
pub struct PodU128 {
    pub bytes: [u8; 16],
}

impl PodU128 {
    pub fn get(&self) -> u128 {
        u128::from_le_bytes(self.bytes)
    }

    pub fn set(&mut self, v: u128) {
        self.bytes = v.to_le_bytes();
    }
}

#[zero_copy]
#[derive(Default, Debug, PartialEq, Eq)]
pub struct PodI128 {
    pub bytes: [u8; 16],
}

impl PodI128 {
    pub fn get(&self) -> i128 {
        i128::from_le_bytes(self.bytes)
    }

    pub fn set(&mut self, v: i128) {
        self.bytes = v.to_le_bytes();
    }
}
