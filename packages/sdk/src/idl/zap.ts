/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/zap.json`.
 */
export type Zap = {
  "address": "H7YEstzQnFYuAkSXgPLe1YrL5WoUvgvo4cyndrQsgcwi",
  "metadata": {
    "name": "zap",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ZAP Protocol: oracle-priced perpetual futures on Solana"
  },
  "instructions": [
    {
      "name": "addCollateral",
      "discriminator": [
        127,
        82,
        121,
        42,
        161,
        176,
        249,
        206
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "addMarket",
      "discriminator": [
        41,
        137,
        185,
        126,
        69,
        139,
        254,
        55
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u16"
        },
        {
          "name": "feedId",
          "type": "u32"
        },
        {
          "name": "expo",
          "type": "i16"
        },
        {
          "name": "symbol",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "marketParams"
            }
          }
        }
      ]
    },
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market"
        },
        {
          "name": "account",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeAccount",
      "discriminator": [
        125,
        255,
        149,
        14,
        110,
        34,
        72,
        24
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closePosition",
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        },
        {
          "name": "size",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createAccount",
      "discriminator": [
        99,
        20,
        130,
        119,
        196,
        235,
        131,
        149
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "rentPayer",
          "docs": [
            "Pays the account rent (the relayer, so users never need SOL); refunded when the account closes."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sessionKey",
          "type": "pubkey"
        },
        {
          "name": "sessionExpiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "custody",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeTrigger",
      "docs": [
        "Permissionless: executes a triggered order (`target` 0, `id` = order id) or a position's take-profit (1) or",
        "stop-loss (2) (`id` = position id)."
      ],
      "discriminator": [
        158,
        99,
        201,
        137,
        192,
        20,
        236,
        136
      ],
      "accounts": [
        {
          "name": "executor",
          "docs": [
            "Anyone (in practice, the keeper). Pays only the transaction fee."
          ],
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "target",
          "type": "u8"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "custody",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  115,
                  116,
                  111,
                  100,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "liquidate",
      "docs": [
        "Permissionless liquidation at the signed oracle price."
      ],
      "discriminator": [
        223,
        179,
        226,
        125,
        48,
        46,
        39,
        74
      ],
      "accounts": [
        {
          "name": "liquidator",
          "signer": true
        },
        {
          "name": "liquidatorAccount",
          "docs": [
            "The liquidator's own trading account, credited with the liquidation reward."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "liquidator"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lpDeposit",
      "discriminator": [
        27,
        77,
        210,
        69,
        12,
        43,
        148,
        16
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lpWithdraw",
      "discriminator": [
        205,
        206,
        130,
        170,
        173,
        51,
        11,
        169
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openPosition",
      "discriminator": [
        135,
        128,
        47,
        77,
        15,
        152,
        240,
        49
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "size",
          "type": "u64"
        },
        {
          "name": "collateral",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        },
        {
          "name": "tpPrice",
          "type": "u64"
        },
        {
          "name": "slPrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeOrder",
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market"
        },
        {
          "name": "account",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "flags",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        },
        {
          "name": "sizeUsd",
          "type": "u64"
        },
        {
          "name": "collateral",
          "type": "u64"
        },
        {
          "name": "triggerPrice",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        },
        {
          "name": "tpPrice",
          "type": "u64"
        },
        {
          "name": "slPrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refreshMarkets",
      "docs": [
        "`price_msg` must stay the first argument: the ed25519 check expects it at a fixed offset."
      ],
      "discriminator": [
        34,
        17,
        207,
        192,
        43,
        104,
        149,
        19
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "removeCollateral",
      "discriminator": [
        86,
        222,
        130,
        86,
        92,
        20,
        72,
        65
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "reversePosition",
      "discriminator": [
        242,
        155,
        136,
        35,
        118,
        199,
        172,
        130
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        },
        {
          "name": "pythStorage"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceMsg",
          "type": "bytes"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revokeSession",
      "discriminator": [
        86,
        92,
        198,
        120,
        144,
        2,
        7,
        194
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "account",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "setMarketStatus",
      "discriminator": [
        101,
        175,
        83,
        107,
        200,
        141,
        155,
        182
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u16"
        },
        {
          "name": "status",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setSession",
      "discriminator": [
        156,
        135,
        126,
        111,
        184,
        206,
        194,
        141
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "sessionKey",
          "type": "pubkey"
        },
        {
          "name": "sessionExpiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "setTpsl",
      "discriminator": [
        11,
        47,
        134,
        201,
        75,
        78,
        150,
        177
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "account",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "positionId",
          "type": "u64"
        },
        {
          "name": "tpPrice",
          "type": "u64"
        },
        {
          "name": "slPrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateMarket",
      "discriminator": [
        153,
        39,
        2,
        197,
        179,
        50,
        199,
        217
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u16"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "marketParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateOrder",
      "discriminator": [
        54,
        8,
        208,
        207,
        34,
        134,
        239,
        168
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market"
        },
        {
          "name": "account",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "triggerPrice",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "custody",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "tradingAccount",
      "discriminator": [
        104,
        138,
        0,
        69,
        222,
        142,
        24,
        121
      ]
    }
  ],
  "events": [
    {
      "name": "accountClosed",
      "discriminator": [
        19,
        250,
        79,
        236,
        91,
        80,
        148,
        48
      ]
    },
    {
      "name": "accountCreated",
      "discriminator": [
        70,
        39,
        6,
        173,
        118,
        198,
        190,
        91
      ]
    },
    {
      "name": "collateralChanged",
      "discriminator": [
        172,
        114,
        48,
        57,
        98,
        83,
        95,
        157
      ]
    },
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "liquidated",
      "discriminator": [
        231,
        57,
        55,
        75,
        0,
        170,
        246,
        68
      ]
    },
    {
      "name": "lpDeposited",
      "discriminator": [
        85,
        211,
        184,
        159,
        176,
        224,
        28,
        72
      ]
    },
    {
      "name": "lpWithdrawn",
      "discriminator": [
        188,
        10,
        43,
        60,
        223,
        238,
        51,
        153
      ]
    },
    {
      "name": "marketListed",
      "discriminator": [
        29,
        11,
        143,
        239,
        139,
        12,
        79,
        19
      ]
    },
    {
      "name": "marketRefreshed",
      "discriminator": [
        137,
        5,
        228,
        141,
        72,
        86,
        38,
        197
      ]
    },
    {
      "name": "marketUpdated",
      "discriminator": [
        170,
        51,
        74,
        147,
        116,
        168,
        217,
        251
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "orderUpdated",
      "discriminator": [
        172,
        140,
        210,
        241,
        108,
        117,
        122,
        145
      ]
    },
    {
      "name": "sessionChanged",
      "discriminator": [
        185,
        82,
        255,
        175,
        167,
        232,
        171,
        235
      ]
    },
    {
      "name": "tpslChanged",
      "discriminator": [
        61,
        105,
        41,
        57,
        145,
        176,
        205,
        187
      ]
    },
    {
      "name": "trade",
      "discriminator": [
        24,
        254,
        218,
        152,
        253,
        43,
        18,
        81
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not the account owner or its active session key"
    },
    {
      "code": 6001,
      "name": "sessionExpired",
      "msg": "Session key has expired"
    },
    {
      "code": 6002,
      "name": "invalidSessionExpiry",
      "msg": "Session expiry is outside the allowed window"
    },
    {
      "code": 6003,
      "name": "protocolPaused",
      "msg": "Protocol is paused for new risk"
    },
    {
      "code": 6004,
      "name": "marketPaused",
      "msg": "Market is paused"
    },
    {
      "code": 6005,
      "name": "marketReduceOnly",
      "msg": "Market only accepts position reductions"
    },
    {
      "code": 6006,
      "name": "lpPaused",
      "msg": "LP deposits and withdrawals are paused"
    },
    {
      "code": 6007,
      "name": "lpCooldown",
      "msg": "LP shares are still in their cooldown"
    },
    {
      "code": 6008,
      "name": "positionNotFound",
      "msg": "Position not found"
    },
    {
      "code": 6009,
      "name": "idMismatch",
      "msg": "Position or order id does not match the slot"
    },
    {
      "code": 6010,
      "name": "slotsFull",
      "msg": "No free position or order slot"
    },
    {
      "code": 6011,
      "name": "accountNotEmpty",
      "msg": "Trading account still has positions, orders, balance or LP shares"
    },
    {
      "code": 6012,
      "name": "wrongMarket",
      "msg": "Wrong market account"
    },
    {
      "code": 6013,
      "name": "tooManyMarkets",
      "msg": "Too many markets"
    },
    {
      "code": 6014,
      "name": "missingMarkets",
      "msg": "Every listed market must be passed, in index order"
    },
    {
      "code": 6015,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6016,
      "name": "minSize",
      "msg": "Order is below the minimum size"
    },
    {
      "code": 6017,
      "name": "maxLeverage",
      "msg": "Leverage above the market maximum"
    },
    {
      "code": 6018,
      "name": "wouldBeLiquidatable",
      "msg": "Position would be liquidatable"
    },
    {
      "code": 6019,
      "name": "notLiquidatable",
      "msg": "Position is not liquidatable"
    },
    {
      "code": 6020,
      "name": "slippage",
      "msg": "Fill price is worse than the acceptable price"
    },
    {
      "code": 6021,
      "name": "triggerNotMet",
      "msg": "Trigger price not reached"
    },
    {
      "code": 6022,
      "name": "postOnlyWouldFill",
      "msg": "Post-only order would fill immediately"
    },
    {
      "code": 6023,
      "name": "oiCap",
      "msg": "Open interest cap reached for this side"
    },
    {
      "code": 6024,
      "name": "utilizationCap",
      "msg": "Vault utilization cap reached"
    },
    {
      "code": 6025,
      "name": "maxPosition",
      "msg": "Position size above the market maximum"
    },
    {
      "code": 6026,
      "name": "withdrawLimit",
      "msg": "Amount exceeds what can be withdrawn now"
    },
    {
      "code": 6027,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6028,
      "name": "ed25519Missing",
      "msg": "Missing ed25519 signature instruction before this instruction"
    },
    {
      "code": 6029,
      "name": "ed25519Offsets",
      "msg": "Unexpected ed25519 instruction layout or offsets"
    },
    {
      "code": 6030,
      "name": "messageMismatch",
      "msg": "Signed message does not match this instruction's data"
    },
    {
      "code": 6031,
      "name": "badMagic",
      "msg": "Unknown price message format"
    },
    {
      "code": 6032,
      "name": "malformedPriceMessage",
      "msg": "Price message is malformed"
    },
    {
      "code": 6033,
      "name": "untrustedSigner",
      "msg": "Price signer is not trusted"
    },
    {
      "code": 6034,
      "name": "badPythStorage",
      "msg": "Invalid Pyth storage account"
    },
    {
      "code": 6035,
      "name": "unknownProperty",
      "msg": "Unknown property in price message"
    },
    {
      "code": 6036,
      "name": "feedMissing",
      "msg": "Market feed missing from price message"
    },
    {
      "code": 6037,
      "name": "priceMissing",
      "msg": "Price missing or not positive"
    },
    {
      "code": 6038,
      "name": "exponentMismatch",
      "msg": "Price exponent does not match the market"
    },
    {
      "code": 6039,
      "name": "channelMismatch",
      "msg": "Price message channel not accepted"
    },
    {
      "code": 6040,
      "name": "priceStale",
      "msg": "Price is too old"
    },
    {
      "code": 6041,
      "name": "priceFromFuture",
      "msg": "Price timestamp is in the future"
    },
    {
      "code": 6042,
      "name": "feedStale",
      "msg": "Feed has not updated recently"
    },
    {
      "code": 6043,
      "name": "belowWatermark",
      "msg": "Price is older than the market's latest price"
    },
    {
      "code": 6044,
      "name": "belowPositionTimestamp",
      "msg": "Price is older than the price last used by this position or order"
    },
    {
      "code": 6045,
      "name": "confidenceTooWide",
      "msg": "Price confidence too wide to open risk"
    },
    {
      "code": 6046,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6047,
      "name": "invalidParams",
      "msg": "Invalid parameters"
    }
  ],
  "types": [
    {
      "name": "accountClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "accountCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "sessionKey",
            "type": "pubkey"
          },
          {
            "name": "sessionExpiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "collateralChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "u16"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "positionId",
            "type": "u64"
          },
          {
            "name": "delta",
            "docs": [
              "Positive: added from the balance; negative: removed to the balance."
            ],
            "type": "i64"
          },
          {
            "name": "collateralAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Protocol-wide settings. Changed only by the admin."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "custody",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "poolBump",
            "type": "u8"
          },
          {
            "name": "custodyBump",
            "type": "u8"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "configParams"
              }
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "configParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pythStorage",
            "docs": [
              "Pyth Pro storage account listing trusted signers (used when `use_pyth_storage`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "oracleSigners",
            "docs": [
              "Additional trusted price signers with their expiry (unix seconds); unused slots are the default key."
            ],
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "oracleSignerExpiry",
            "type": {
              "array": [
                "i64",
                2
              ]
            }
          },
          {
            "name": "usePythStorage",
            "type": "bool"
          },
          {
            "name": "requiredChannel",
            "docs": [
              "Accepted Pyth Pro channel (3 = fixed rate 200ms)."
            ],
            "type": "u8"
          },
          {
            "name": "maxPriceAgeS",
            "docs": [
              "Oldest accepted message timestamp, seconds."
            ],
            "type": "u32"
          },
          {
            "name": "maxFutureS",
            "docs": [
              "Furthest accepted message timestamp ahead of the cluster clock, seconds."
            ],
            "type": "u32"
          },
          {
            "name": "maxFeedAgeS",
            "docs": [
              "Oldest accepted feed update (guards against carried-forward prices), seconds."
            ],
            "type": "u32"
          },
          {
            "name": "priceGraceMs",
            "docs": [
              "How far behind a market's latest used price a new price may be, milliseconds."
            ],
            "type": "u32"
          },
          {
            "name": "minOrderUsd",
            "type": "u64"
          },
          {
            "name": "maxUtilBps",
            "docs": [
              "Reserved liquidity / vault assets cap for new risk."
            ],
            "type": "u16"
          },
          {
            "name": "liqFeeBps",
            "type": "u16"
          },
          {
            "name": "liquidatorShareBps",
            "type": "u16"
          },
          {
            "name": "protocolFeeShareBps",
            "docs": [
              "Share of trading and borrow fees kept by the protocol; the rest goes to LPs."
            ],
            "type": "u16"
          },
          {
            "name": "borrowKinkUtilBps",
            "type": "u16"
          },
          {
            "name": "borrowKinkAprBps",
            "type": "u16"
          },
          {
            "name": "borrowMaxAprBps",
            "type": "u16"
          },
          {
            "name": "fundingMaxHourly",
            "docs": [
              "Funding rate at full imbalance, per hour (1e18 = 100%)."
            ],
            "type": "u64"
          },
          {
            "name": "sessionMaxSecs",
            "type": "u32"
          },
          {
            "name": "lpFeeBps",
            "type": "u16"
          },
          {
            "name": "lpCooldownS",
            "type": "u32"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new risk (opens, order placement) only; closes, liquidations and withdrawals always work."
            ],
            "type": "bool"
          },
          {
            "name": "lpPaused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "configParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "accountSeq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "liquidator",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "u16"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "positionId",
            "type": "u64"
          },
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "oraclePrice",
            "type": "u64"
          },
          {
            "name": "pnl",
            "type": "i64"
          },
          {
            "name": "owed",
            "type": "i64"
          },
          {
            "name": "toLiquidator",
            "type": "u64"
          },
          {
            "name": "toVaultFee",
            "type": "u64"
          },
          {
            "name": "toTrader",
            "type": "u64"
          },
          {
            "name": "badDebt",
            "docs": [
              "Loss beyond the position's collateral, absorbed by the vault."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "nav",
            "type": "u64"
          },
          {
            "name": "lpSupplyAfter",
            "type": "u64"
          },
          {
            "name": "poolSeq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "nav",
            "type": "u64"
          },
          {
            "name": "lpSupplyAfter",
            "type": "u64"
          },
          {
            "name": "poolSeq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "One perpetual market: parameters, per-side open interest aggregates, funding indices and the price watermark."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "feedId",
            "docs": [
              "Pyth Pro feed id."
            ],
            "type": "u32"
          },
          {
            "name": "expo",
            "docs": [
              "Pyth exponent of the feed; fixed at listing."
            ],
            "type": "i16"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "symbol",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "marketParams"
              }
            }
          },
          {
            "name": "oiLong",
            "docs": [
              "Σ size (entry notional, USD 6 decimals) per side."
            ],
            "type": "u64"
          },
          {
            "name": "oiShort",
            "type": "u64"
          },
          {
            "name": "unitsLong",
            "docs": [
              "Σ units (12 decimals) per side: gives the traders' aggregate PnL in O(1)."
            ],
            "type": {
              "defined": {
                "name": "podU128"
              }
            }
          },
          {
            "name": "unitsShort",
            "type": {
              "defined": {
                "name": "podU128"
              }
            }
          },
          {
            "name": "fundingIndexLong",
            "docs": [
              "Cumulative funding owed per unit of size (1e18 = 100%); long grows and short shrinks when longs pay."
            ],
            "type": {
              "defined": {
                "name": "podI128"
              }
            }
          },
          {
            "name": "fundingIndexShort",
            "type": {
              "defined": {
                "name": "podI128"
              }
            }
          },
          {
            "name": "sumSfLong",
            "docs": [
              "Σ size · funding index at each position's last settlement, per side (unscaled)."
            ],
            "type": {
              "defined": {
                "name": "podI128"
              }
            }
          },
          {
            "name": "sumSfShort",
            "type": {
              "defined": {
                "name": "podI128"
              }
            }
          },
          {
            "name": "fundingRate",
            "docs": [
              "Current funding rate per second (1e18 = 100%), recomputed after every open-interest change."
            ],
            "type": {
              "defined": {
                "name": "podI128"
              }
            }
          },
          {
            "name": "lastAccrualTs",
            "type": "i64"
          },
          {
            "name": "lastPrice",
            "docs": [
              "Latest accepted oracle price (12 decimals) and confidence, and its publish time: the watermark new prices",
              "must not fall behind (minus the configured grace)."
            ],
            "type": "u64"
          },
          {
            "name": "lastConf",
            "type": "u64"
          },
          {
            "name": "lastPriceTsUs",
            "type": "u64"
          },
          {
            "name": "tradeSeq",
            "type": "u64"
          },
          {
            "name": "cumVolume",
            "type": "u64"
          },
          {
            "name": "cumFees",
            "type": "u64"
          },
          {
            "name": "cumFundingNet",
            "type": "i64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marketListed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "feedId",
            "type": "u32"
          },
          {
            "name": "expo",
            "type": "i16"
          },
          {
            "name": "symbol",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "marketParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "marketParams",
      "docs": [
        "Risk and fee parameters of a market. Changeable by the admin without touching open positions' entries.",
        "Stored inside the zero-copy `Market` and also passed as an instruction argument, hence both Pod and Borsh."
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxLeverage",
            "type": "u16"
          },
          {
            "name": "mmrBps",
            "type": "u16"
          },
          {
            "name": "openFeeBps",
            "type": "u16"
          },
          {
            "name": "closeFeeBps",
            "type": "u16"
          },
          {
            "name": "confMultBps",
            "docs": [
              "Half-spread from the Pyth confidence interval, as a multiple (1e4 = 1.0×)."
            ],
            "type": "u16"
          },
          {
            "name": "maxConfBps",
            "docs": [
              "New risk is refused while confidence / price exceeds this."
            ],
            "type": "u16"
          },
          {
            "name": "impactCapBps",
            "type": "u16"
          },
          {
            "name": "oiCapLongBps",
            "docs": [
              "Open interest caps per side, as a share of vault assets."
            ],
            "type": "u16"
          },
          {
            "name": "oiCapShortBps",
            "type": "u16"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "minSpreadFrac",
            "docs": [
              "Minimum half-spread (1e12 = 100%, so 1bp = 1e8)."
            ],
            "type": "u64"
          },
          {
            "name": "impactDepthUsd",
            "docs": [
              "Price-impact depth in USD (6 decimals): larger means less impact."
            ],
            "type": "u64"
          },
          {
            "name": "maxPositionUsd",
            "docs": [
              "Largest single position (USD, 6 decimals)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketRefreshed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceTsUs",
            "type": "u64"
          },
          {
            "name": "fundingRate",
            "type": "i128"
          },
          {
            "name": "fundingIndexLong",
            "type": "i128"
          },
          {
            "name": "fundingIndexShort",
            "type": "i128"
          },
          {
            "name": "borrowIndex",
            "type": "u128"
          },
          {
            "name": "poolSeq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "marketParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "order",
      "docs": [
        "A resting order: opening limit/stop orders escrow their margin and fee; take-profit and stop-loss orders reduce a",
        "position (possibly partially, which gives multi-level take-profits)."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "positionId",
            "docs": [
              "Position this order reduces (0 for opening orders)."
            ],
            "type": "u64"
          },
          {
            "name": "sizeUsd",
            "docs": [
              "Size to open or close (USD entry notional); u64::MAX closes the whole position."
            ],
            "type": "u64"
          },
          {
            "name": "collateralEscrow",
            "type": "u64"
          },
          {
            "name": "feeEscrow",
            "type": "u64"
          },
          {
            "name": "triggerPrice",
            "type": "u64"
          },
          {
            "name": "acceptablePrice",
            "docs": [
              "Worst acceptable fill price (0 = none)."
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix seconds; the executing price must be published after this."
            ],
            "type": "i64"
          },
          {
            "name": "tpPrice",
            "docs": [
              "Take-profit / stop-loss to attach to the position when an opening order fills (0 = none)."
            ],
            "type": "u64"
          },
          {
            "name": "slPrice",
            "type": "u64"
          },
          {
            "name": "marketIndex",
            "type": "u16"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "flags",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "market",
            "type": "u16"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "flags",
            "type": "u8"
          },
          {
            "name": "positionId",
            "type": "u64"
          },
          {
            "name": "sizeUsd",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "triggerPrice",
            "type": "u64"
          },
          {
            "name": "acceptablePrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "triggerPrice",
            "type": "u64"
          },
          {
            "name": "acceptablePrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "podI128",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bytes",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "podU128",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bytes",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "pool",
      "docs": [
        "The LP vault: realized assets, reserved liquidity, LP share supply, and the pool-wide borrow index.",
        "Also the authority of the custody token account that holds all USDC."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assets",
            "docs": [
              "LP-owned USDC after realized trader PnL and fees (6 decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Σ open position sizes: each position reserves its maximum payout."
            ],
            "type": "u64"
          },
          {
            "name": "lpSupply",
            "type": "u64"
          },
          {
            "name": "protocolFees",
            "docs": [
              "Protocol's share of fees, withdrawable by the admin."
            ],
            "type": "u64"
          },
          {
            "name": "borrowIndex",
            "docs": [
              "Cumulative borrow index (1e18 = 100%)."
            ],
            "type": {
              "defined": {
                "name": "podU128"
              }
            }
          },
          {
            "name": "sumSizeBorrowEntry",
            "docs": [
              "Σ size · borrow index at each position's last settlement (unscaled)."
            ],
            "type": {
              "defined": {
                "name": "podU128"
              }
            }
          },
          {
            "name": "borrowLastTs",
            "type": "i64"
          },
          {
            "name": "seq",
            "docs": [
              "Increments on every event, so indexers can detect gaps."
            ],
            "type": "u64"
          },
          {
            "name": "numMarkets",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "cumTradingFees",
            "type": "u64"
          },
          {
            "name": "cumBorrowFees",
            "type": "u64"
          },
          {
            "name": "cumLiquidationFees",
            "type": "u64"
          },
          {
            "name": "cumSpreadImpact",
            "type": "u64"
          },
          {
            "name": "cumFundingNet",
            "type": "i64"
          },
          {
            "name": "cumTraderPnl",
            "type": "i64"
          },
          {
            "name": "cumVolume",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "position",
      "docs": [
        "An open position (isolated margin). Hedge mode: a market can hold one long and one short at the same time."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "positionId",
            "type": "u64"
          },
          {
            "name": "sizeUsd",
            "docs": [
              "Entry notional (USD, 6 decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "units",
            "docs": [
              "Base-asset units (12 decimals)."
            ],
            "type": {
              "defined": {
                "name": "podU128"
              }
            }
          },
          {
            "name": "entryFundingIndex",
            "docs": [
              "Indices at the last settlement; accrued funding and borrow are settled into collateral on every change."
            ],
            "type": {
              "defined": {
                "name": "podI128"
              }
            }
          },
          {
            "name": "entryBorrowIndex",
            "type": {
              "defined": {
                "name": "podU128"
              }
            }
          },
          {
            "name": "lastPriceTsUs",
            "docs": [
              "Publish time of the last price used; later prices for this position may not be older."
            ],
            "type": "u64"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "tpPrice",
            "docs": [
              "Take-profit and stop-loss trigger prices (12 decimals), 0 when unset."
            ],
            "type": "u64"
          },
          {
            "name": "slPrice",
            "type": "u64"
          },
          {
            "name": "realizedPnl",
            "type": "i64"
          },
          {
            "name": "feesPaid",
            "type": "u64"
          },
          {
            "name": "marketIndex",
            "type": "u16"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "sessionChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "sessionKey",
            "type": "pubkey"
          },
          {
            "name": "sessionExpiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tpslChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "u16"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "positionId",
            "type": "u64"
          },
          {
            "name": "tpPrice",
            "type": "u64"
          },
          {
            "name": "slPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "trade",
      "docs": [
        "Every fill. USD amounts have 6 decimals; prices 12."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolSeq",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "u16"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "positionId",
            "type": "u64"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "sizeDelta",
            "docs": [
              "Entry notional opened (positive) or closed (negative)."
            ],
            "type": "i64"
          },
          {
            "name": "sizeAfter",
            "type": "u64"
          },
          {
            "name": "collateralAfter",
            "type": "u64"
          },
          {
            "name": "oraclePrice",
            "type": "u64"
          },
          {
            "name": "fillPrice",
            "type": "u64"
          },
          {
            "name": "priceTsUs",
            "type": "u64"
          },
          {
            "name": "openFee",
            "type": "u64"
          },
          {
            "name": "closeFee",
            "type": "u64"
          },
          {
            "name": "spreadCost",
            "type": "u64"
          },
          {
            "name": "impactCost",
            "type": "u64"
          },
          {
            "name": "borrowPaid",
            "type": "u64"
          },
          {
            "name": "fundingPaid",
            "docs": [
              "Positive: paid by the trader; negative: received."
            ],
            "type": "i64"
          },
          {
            "name": "pnl",
            "type": "i64"
          },
          {
            "name": "payout",
            "docs": [
              "Credited to the trader's balance."
            ],
            "type": "u64"
          },
          {
            "name": "oiLongAfter",
            "type": "u64"
          },
          {
            "name": "oiShortAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tradingAccount",
      "docs": [
        "A trader's account: USDC balance, LP shares, session key, and inline position and order slots.",
        "One account per owner wallet. Rent is paid by the relayer and refunded to it when the account closes."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "sessionKey",
            "docs": [
              "Signs trades without the owner (no wallet pop-ups). Cannot withdraw or change the session."
            ],
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "sessionExpiresAt",
            "type": "i64"
          },
          {
            "name": "balance",
            "docs": [
              "Free USDC (6 decimals), not backing any position or order."
            ],
            "type": "u64"
          },
          {
            "name": "lpShares",
            "type": "u64"
          },
          {
            "name": "lpCostBasis",
            "docs": [
              "USDC paid for the LP shares still held, for LP PnL."
            ],
            "type": "u64"
          },
          {
            "name": "lpLastDepositTs",
            "type": "i64"
          },
          {
            "name": "nextPositionId",
            "type": "u64"
          },
          {
            "name": "nextOrderId",
            "type": "u64"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "realizedPnl",
            "type": "i64"
          },
          {
            "name": "feesPaid",
            "type": "u64"
          },
          {
            "name": "fundingPaid",
            "type": "i64"
          },
          {
            "name": "borrowPaid",
            "type": "u64"
          },
          {
            "name": "volume",
            "type": "u64"
          },
          {
            "name": "deposited",
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "positions",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "position"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "orders",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "order"
                  }
                },
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "accountSeq",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
