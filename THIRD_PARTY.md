# Third-Party Attributions

This project builds on several third-party libraries, templates, integrations,
and platform heuristics. Their licenses, terms, and relevant implementation
notes are listed below.

---

## Finapp — Wallet & Banking HTML Mobile Template

- **Author:** Bragher
- **Source:** https://themeforest.net/item/finapp-wallet-banking-html-mobile-template/25738217
- **Version used:** 2.2.1
- **License:** ThemeForest Regular / Extended License (Envato Market License)

The Finapp template provides the core UI framework, CSS/Sass architecture, and JavaScript base for this application. A commercial license for Finapp has been purchased by the team. The license ID is stored in the team password manager (not in this repository). Per the Envato Market terms, redistribution of the template source files is not permitted.

---

## Bootstrap

- **Author:** The Bootstrap Authors
- **Source:** https://getbootstrap.com
- **License:** MIT License — https://github.com/twbs/bootstrap/blob/main/LICENSE

Bundled as `assets/js/lib/bootstrap.bundle.min.js`.

---

## Ionicons

- **Author:** Ionic Team
- **Source:** https://ionic.io/ionicons
- **License:** MIT License — https://github.com/ionic-team/ionicons/blob/main/LICENSE

Loaded from CDN (`unpkg.com/ionicons@5.5.2`).

---

## Splide

- **Author:** Naotoshi Fujita
- **Source:** https://splidejs.com
- **License:** MIT License — https://github.com/Splidejs/splide/blob/master/LICENSE

Bundled as `assets/js/plugins/splide/splide.min.js`.

---

## ApexCharts

- **Author:** ApexCharts
- **Source:** https://apexcharts.com
- **License:** MIT License — https://github.com/apexcharts/apexcharts.js/blob/master/LICENSE

Bundled as `assets/js/plugins/apexcharts/apexcharts.min.js`.

---

## ChangeNOW Exchange Widget

- **Author:** ChangeNOW
- **Source:** https://changenow.io
- **License:** Proprietary — subject to ChangeNOW Terms of Service

The exchange widget is embedded via iframe from `changenow.io`. All exchange operations are performed by ChangeNOW under their own terms and privacy policy.

The `link_id` query parameter is appended to all ChangeNOW widget URLs to
attribute swaps to the TON-Bridge affiliate account. The point accrual job
(issue #48) polls the ChangeNOW partner API for swaps in `finished` state
attributed to this `link_id`.

Only `finished` swaps trigger point accrual (guardrail a). Intermediate
states (`waiting`, `confirming`, `exchanging`, `sending`) do not trigger
payouts — see `assets/js/anti-fraud.js: isEligibleForReferralBonus()`.

---

## Telegram Web App SDK

- **Author:** Telegram
- **Source:** https://core.telegram.org/bots/webapps
- **License:** Proprietary — subject to Telegram Terms of Service

Used for Telegram Mini App integration (theme sync, navigation, haptic feedback).

---

## Telegram account-age heuristic

**Problem:** Telegram does not expose the date a user account was created via
any public API available to Mini Apps or bots.

**Why we need it:** Anti-fraud guardrail (d) (issue #50) requires that points
become withdrawable only after a user's Telegram account is at least **7 days
old**. Fresh accounts are a common tool in Sybil attacks.

### Heuristic approach

We use two complementary signals:

#### Signal 1 — Numeric user ID range

Telegram assigns user IDs sequentially. Accounts with a numeric ID below
approximately **1 000 000 000** were created before roughly 2019 and are
therefore guaranteed to be well beyond the 7-day gate. These accounts are
unconditionally allowed to withdraw without further age estimation.

This signal is a coarse allowlist, not a blocklist — it only bypasses the
check; it never blocks anyone.

#### Signal 2 — `auth_date` floor

The Telegram Mini App `initData` object contains `auth_date`: the Unix
timestamp at which the user launched the Mini App (signed by Telegram). This
is the most recent proof of account existence we have.

We conservatively assume the account could have been created up to 7 days
*before* `auth_date`. Therefore:

```
estimated_creation_unix = auth_date_unix - 7 * 86400
estimated_age_days      = (now_unix - estimated_creation_unix) / 86400
```

If `estimated_age_days < 7`, the account is still in the vesting window.

**In practice:** a genuine user who opens the app for the first time on day 0
will have `auth_date ≈ now`, so `estimated_age_days ≈ 7`. They will need to
return and try withdrawing after 7 days from first app open. A Sybil attacker
creating a fresh account right before claiming cannot satisfy the gate without
waiting the full 7 days.

### Limitations

- The heuristic cannot distinguish an account created today from one created
  years ago that is opening the Mini App for the first time. We accept this
  false-positive (legitimate old-account user is briefly gated) in exchange
  for blocking Sybil accounts.
- High-ID accounts (≥ 1 000 000 000) that are genuinely old but received a
  recycled/re-issued ID are rare; they will simply need to wait 7 days from
  their first app open.
- The 80 % concentration threshold (guardrail c) and $50 k daily cap
  (guardrail b) should be revisited after a month of production data.

### References

- Telegram Bot API — `getUpdates` / webhook: `from.id` field (sequential,
  integer, no creation date).
- Telegram Mini App SDK — `initDataUnsafe.user` (includes `id`, `auth_date`).
- Community research on ID ranges:
  <https://github.com/telegramdesktop/tdesktop/issues/> (various threads on
  ID allocation).
