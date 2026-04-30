# Lighthouse Performance Budgets

This document records the performance budgets enforced in CI (`.lighthouserc.json`) and the rationale for each threshold. Future changes to these numbers should be accompanied by an explanation of why the target was relaxed or tightened.

## Measurement conditions

All assertions are measured under **simulated Moto G4 on a 4G connection** (Lighthouse `perf` preset, mobile form factor):

| Parameter | Value |
|-----------|-------|
| RTT | 150 ms |
| Throughput | 1 638 Kbps down / 675 Kbps up |
| CPU slowdown | 4× |
| Viewport | 360 × 640, 2.625 dpr |

URLs tested on every PR:
- `/index.html` — Bridge tab
- `/index2.html` — Exchange tab
- `/index3.html` — OTC tab

## Budgets

| Metric | Limit | Rationale |
|--------|-------|-----------|
| `largest-contentful-paint` | ≤ 2 500 ms | Google's "Good" LCP threshold. Exceeding 2.5 s is the point where users measurably start abandoning page loads. Telegram Mini Apps open inside the app — the user already paid the network cost getting to Telegram; the shell must be fast. |
| `total-blocking-time` | ≤ 300 ms | Maps to an INP budget sufficient to keep the UI responsive on mid-range Android devices (Moto G4 4× CPU slowdown). |
| `cumulative-layout-shift` | ≤ 0.1 | Google "Good" CLS threshold. Layout shifts are especially jarring in a Mini App context where there is no browser chrome to indicate the page is still loading. |
| `categories:performance` | ≥ 0.85 | Ensures the overall performance score stays in the "good" band. The three per-metric assertions above are the primary controls; this score acts as a secondary catch-all for regressions in metrics not individually budgeted. |
| `categories:accessibility` | ≥ 0.90 | Baseline accessibility for Telegram's broad user base, including users with assistive technologies. Any new UI elements must not regress this. |
| `resource-summary:script:size` | ≤ 200 KB | Total JavaScript transferred (compressed). Keeps parse and evaluation time in budget on low-end devices. The ChangeNOW iframe JS is excluded because it loads in a cross-origin frame. |
| `resource-summary:stylesheet:size` | ≤ 30 KB | Total CSS transferred. The compressed `style.css` produced by the Sass build should remain below this after the inline-critical-CSS work (issue #21). |

## Adjusting a budget

Before raising a limit:

1. Confirm the regression is intentional (e.g. a new feature genuinely requires more JS).
2. Update this file with the new value **and** the reason in the same commit.
3. Add a follow-up task to recover the budget (e.g. code-split the new dependency).

Before lowering a limit:

1. Verify on the CI run that the actual measured value is comfortably below the new threshold (margin ≥ 15 %).
2. Update this file in the same commit.
