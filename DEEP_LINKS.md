# TON Bridge — Deep-link grammar

Open the TMA directly in a pre-filled state by passing `start_param` in the Telegram Mini App URL:

```
https://t.me/TONBridge_robot/app?startapp=<start_param>
```

`start_param` must be URL-safe and ≤ 64 characters.

---

## Grammar reference

| Pattern | Example | Effect |
|---------|---------|--------|
| `bridge_<from>_<to>_<amount>` | `bridge_ton_tonbsc_10` | Opens **Bridge** tab pre-filled with *from/to/amount* |
| `exchange_<from>_<to>_<amount>` | `exchange_btc_ton_0.1` | Opens **Exchange** tab pre-filled |
| `otc_<from>_<to>_<amount>` | `otc_usdtton_ton_1000000` | Opens **OTC** tab pre-filled |
| `order_<id>` | `order_abc123` | Opens **Bridge** tab focused on the given order |
| `ref_<code>` | `ref_A1B2C3D4` | Captures referral code (see issue [#6.2](https://github.com/xlabtg/TON-Bridge/issues/45)) and lands on Bridge tab |

Unrecognised `start_param` values fall through to the default landing page without error.

---

## Allowed asset names

Asset names are validated against an allowlist before being passed to the widget.  Unrecognised names are rejected and the deep link is ignored.

| Name | Description |
|------|-------------|
| `ton` | TON (native) |
| `tonbsc` | TON on BSC |
| `btc` | Bitcoin |
| `eth` | Ethereum |
| `usdt` | USDT (TRC-20) |
| `usdtton` | USDT on TON |
| `usdtbsc` | USDT on BSC |
| `bnb` | BNB |
| `trx` | TRON |
| `sol` | Solana |
| `near` | NEAR |
| `eos` | EOS |
| `algo` | Algorand |
| `matic` | Polygon |
| `dot` | Polkadot |
| `op` | Optimism |
| `avax` | Avalanche C |
| `xmr` | Monero |
| `ltc` | Litecoin |
| `xrp` | Ripple |
| `ada` | Cardano |
| `doge` | Dogecoin |

To add a new asset, extend the `ALLOWED_ASSETS` array in `assets/js/deep-link.js`.

---

## Constraints

- `start_param` ≤ 64 characters (Telegram limit).
- Prefixes are kept to 3–8 characters to maximise headroom for asset names and amounts.
- Asset names contain no underscores, so `_` is always a field separator.
- `amount` must be a non-negative decimal number (`^\d+(\.\d+)?$`).
- `ref` codes are 4–16 alphanumeric characters.
- `order` IDs are up to 64 word-characters or hyphens.

---

## Implementation

The parser lives in `assets/js/deep-link.js` and is loaded on every widget page.  It exposes:

| Symbol | Purpose |
|--------|---------|
| `TonBridgeDeepLink.parse(param)` | Parse a raw `start_param`; returns a structured object or `null` |
| `TonBridgeDeepLink.buildUrl(startParam)` | Build a `t.me/TONBridge_robot/app?startapp=…` URL |
| `TonBridgeDeepLink.apply(link, currentPage)` | Apply a parsed link to the current page |
| `TonBridgeDeepLink.init(currentPage)` | Read `initDataUnsafe.start_param` and apply (called on page load) |

All code that constructs `t.me/TONBridge_robot/app?startapp=…` URLs **must** call `TonBridgeDeepLink.buildUrl()` so the base URL stays in one place.
