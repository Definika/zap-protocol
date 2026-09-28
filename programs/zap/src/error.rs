use anchor_lang::prelude::*;

#[error_code]
pub enum ZapError {
    // Authorization
    #[msg("Signer is not the account owner or its active session key")]
    Unauthorized,
    #[msg("Session key has expired")]
    SessionExpired,
    #[msg("Session expiry is outside the allowed window")]
    InvalidSessionExpiry,

    // Protocol / market status
    #[msg("Protocol is paused for new risk")]
    ProtocolPaused,
    #[msg("Market is paused")]
    MarketPaused,
    #[msg("Market only accepts position reductions")]
    MarketReduceOnly,
    #[msg("LP deposits and withdrawals are paused")]
    LpPaused,
    #[msg("LP shares are still in their cooldown")]
    LpCooldown,

    // Accounts and slots
    #[msg("Position not found")]
    PositionNotFound,
    #[msg("Position or order id does not match the slot")]
    IdMismatch,
    #[msg("No free position or order slot")]
    SlotsFull,
    #[msg("Trading account still has positions, orders, balance or LP shares")]
    AccountNotEmpty,
    #[msg("Wrong market account")]
    WrongMarket,
    #[msg("Too many markets")]
    TooManyMarkets,
    #[msg("Every listed market must be passed, in index order")]
    MissingMarkets,

    // Balances and risk
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Order is below the minimum size")]
    MinSize,
    #[msg("Leverage above the market maximum")]
    MaxLeverage,
    #[msg("Position would be liquidatable")]
    WouldBeLiquidatable,
    #[msg("Position is not liquidatable")]
    NotLiquidatable,
    #[msg("Fill price is worse than the acceptable price")]
    Slippage,
    #[msg("Trigger price not reached")]
    TriggerNotMet,
    #[msg("Post-only order would fill immediately")]
    PostOnlyWouldFill,
    #[msg("Open interest cap reached for this side")]
    OiCap,
    #[msg("Vault utilization cap reached")]
    UtilizationCap,
    #[msg("Position size above the market maximum")]
    MaxPosition,
    #[msg("Amount exceeds what can be withdrawn now")]
    WithdrawLimit,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    // Oracle
    #[msg("Missing ed25519 signature instruction before this instruction")]
    Ed25519Missing,
    #[msg("Unexpected ed25519 instruction layout or offsets")]
    Ed25519Offsets,
    #[msg("Signed message does not match this instruction's data")]
    MessageMismatch,
    #[msg("Unknown price message format")]
    BadMagic,
    #[msg("Price message is malformed")]
    MalformedPriceMessage,
    #[msg("Price signer is not trusted")]
    UntrustedSigner,
    #[msg("Invalid Pyth storage account")]
    BadPythStorage,
    #[msg("Unknown property in price message")]
    UnknownProperty,
    #[msg("Market feed missing from price message")]
    FeedMissing,
    #[msg("Price missing or not positive")]
    PriceMissing,
    #[msg("Price exponent does not match the market")]
    ExponentMismatch,
    #[msg("Price message channel not accepted")]
    ChannelMismatch,
    #[msg("Price is too old")]
    PriceStale,
    #[msg("Price timestamp is in the future")]
    PriceFromFuture,
    #[msg("Feed has not updated recently")]
    FeedStale,
    #[msg("Price is older than the market's latest price")]
    BelowWatermark,
    #[msg("Price is older than the price last used by this position or order")]
    BelowPositionTimestamp,
    #[msg("Price confidence too wide to open risk")]
    ConfidenceTooWide,

    // Math and params
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid parameters")]
    InvalidParams,
}

impl From<zap_math::MathError> for ZapError {
    fn from(e: zap_math::MathError) -> Self {
        match e {
            zap_math::MathError::InvalidPrice => ZapError::PriceMissing,
            zap_math::MathError::InvalidInput => ZapError::InvalidParams,
            zap_math::MathError::Overflow | zap_math::MathError::DivByZero => ZapError::MathOverflow,
        }
    }
}

/// `?`-friendly conversion for zap-math results inside instruction handlers.
pub trait MathResultExt<T> {
    fn m(self) -> Result<T>;
}

impl<T> MathResultExt<T> for core::result::Result<T, zap_math::MathError> {
    fn m(self) -> Result<T> {
        self.map_err(|e| error!(ZapError::from(e)))
    }
}
