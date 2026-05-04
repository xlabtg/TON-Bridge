# TON Bridge — Directory Listings & UTM Attribution

This document tracks the status of app-directory submissions for **TON Bridge** (part of issue [#36](https://github.com/xlabtg/TON-Bridge/issues/36)).

---

## Directory listing status

| Directory | Category | Status | Launch URL with UTM | App ID / Notes |
|---|---|---|---|---|
| [TON App](https://ton.app) | Bridges | Badge already on homepage — verify claimed & update copy | `https://t.me/TONBridge_robot/app?startapp=utm_source__tonapp__utm_medium__directory__utm_campaign__v2_launch` | appId 2722 |
| [Telegram Apps Center (ton.app)](https://ton.app) | Bridges | To submit | `https://t.me/TONBridge_robot/app?startapp=utm_source__tonapp__utm_medium__directory__utm_campaign__v2_launch` | Same as above |
| [tonapps.com](https://tonapps.com) | DeFi / Bridge | To submit | `https://t.me/TONBridge_robot/app?startapp=utm_source__tonapps__utm_medium__directory__utm_campaign__v2_launch` | — |
| [DappRadar](https://dappradar.com) | Exchanges | To submit | `https://t.me/TONBridge_robot/app?startapp=utm_source__dappradar__utm_medium__directory__utm_campaign__v2_launch` | TON section |
| [TappsCenter](https://tappscenter.org) | Tools | To submit | `https://t.me/TONBridge_robot/app?startapp=utm_source__tappscenter__utm_medium__directory__utm_campaign__v2_launch` | — |

---

## UTM convention

`start_param` format (used by Telegram `t.me/<bot>/app?startapp=…`):

```
utm_source__<source>__utm_medium__<medium>__utm_campaign__<campaign>
```

Fields are separated by `__` (double underscore) because `start_param` only allows `[a-zA-Z0-9_-]` — no `&` or `=`.

The client-side parser in `assets/js/utm.js` decodes this back into `{ utm_source, utm_medium, utm_campaign }`, stores it in `sessionStorage`, and fires a Yandex.Metrika `hit` event so UTM-tagged sessions appear as separate traffic segments.

### Per-directory UTM values

| Directory | `utm_source` | `utm_medium` | `utm_campaign` |
|---|---|---|---|
| TON App | `tonapp` | `directory` | `v2_launch` |
| ton.app | `tonapp` | `directory` | `v2_launch` |
| tonapps.com | `tonapps` | `directory` | `v2_launch` |
| DappRadar | `dappradar` | `directory` | `v2_launch` |
| TappsCenter | `tappscenter` | `directory` | `v2_launch` |

---

## Submission assets

All directories accept the same set of assets. Use the ones already prepared for the PWA manifest (issue [#18](https://github.com/xlabtg/TON-Bridge/issues/18)):

| Asset | Size | Location |
|---|---|---|
| Icon (square) | 512 × 512 px | `assets/img/icon/512x512.png` |
| Icon (square) | 192 × 192 px | `assets/img/icon/192x192.png` |
| Screenshot (portrait) | 390 × 844 px | `assets/img/screenshots/` (to be added, see issue #18) |

**App description (EN):**
> TON Bridge by TONBANKCARD — swap TON across blockchains and exchange 1 200+ cryptocurrencies across 200 networks directly inside Telegram. No registration, no custody, no KYC.

**App description (RU):**
> TON Bridge от TONBANKCARD — переводите TON между блокчейнами и обменивайте 1 200+ криптовалют в 200 сетях прямо в Telegram. Без регистрации, без хранения средств, без KYC.

---

## Contact & credentials

- **Submission email alias:** `listings@tonbankcard.com` (or whichever alias the team decides — use a shared inbox so departures don't lock the team out)
- **Credentials:** stored in the team password manager under the entry **"TON Bridge — App Directory Listings"**. Do **not** commit passwords or API keys here.

---

## Analytics verification checklist

After each listing goes live, verify UTM-tagged traffic appears:

- [ ] **Yandex.Metrika** → Reports → Traffic sources → UTM tags — filter by `utm_campaign=v2_launch`
- [ ] **Telegram Analytics** (`@DataChief_bot`) — new-user segments should reflect directory-attributed opens

---

## Dependency notes

- Deep-link grammar (`start_param` encoding) is part of issue [#31](https://github.com/xlabtg/TON-Bridge/issues/31) (task 4.3).
- Screenshot assets are part of issue [#18](https://github.com/xlabtg/TON-Bridge/issues/18) (task 2.2) — the same assets are reused for directory listings.
