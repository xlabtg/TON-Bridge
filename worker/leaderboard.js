/**
 * Cloudflare Worker — daily leaderboard digest for the TON Bridge channel.
 *
 * Cron: 09:00 UTC every day (see wrangler.toml).
 *
 * Required environment bindings (Wrangler secrets / vars):
 *   BOT_TOKEN              — Telegram bot token (@BotFather)
 *   LEADERBOARD_CHANNEL_ID — channel where the bot is admin (e.g. "@TONBridge_top")
 *   CHANGENOW_API_KEY      — ChangeNOW partner API key
 *
 * Optional KV namespace binding:
 *   LEADERBOARD_KV         — stores leaderboard opt-in flags
 *                            key pattern: "optin:<telegram_user_id>" → "1"
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce an 8-character hex digest that anonymises a Telegram user id.
 * Uses the SubtleCrypto API available in Workers.
 *
 * @param {string|number} telegramId
 * @returns {Promise<string>} 8-char uppercase hex string
 */
export async function hashUserId(telegramId) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(telegramId));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8)
    .toUpperCase();
}

/**
 * Format a USD amount as a compact human-readable string.
 * e.g. 1234567 → "$1.23M", 9876 → "$9,876"
 *
 * @param {number} usd
 * @returns {string}
 */
export function formatUsd(usd) {
  if (usd >= 1_000_000) {
    return '$' + (usd / 1_000_000).toFixed(2) + 'M';
  }
  if (usd >= 1_000) {
    return '$' + usd.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return '$' + usd.toFixed(2);
}

/**
 * Build the deep-link URL for the most popular trading pair.
 *
 * @param {string} from  e.g. "ton"
 * @param {string} to    e.g. "bsc"
 * @returns {string}
 */
export function buildDeepLink(from, to) {
  const param = `${from}_${to}`.toLowerCase();
  return `https://t.me/TONBridge_robot/app?startapp=${param}`;
}

/**
 * Compose the HTML message body that Telegram will render.
 *
 * @param {Array<{rank:number, display:string, usd:number, from:string, to:string}>} topBridges
 * @param {number} totalVolume
 * @param {number} totalSwaps
 * @param {string} popularFrom
 * @param {string} popularTo
 * @returns {string}
 */
export function buildMessage(topBridges, totalVolume, totalSwaps, popularFrom, popularTo) {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lines = [
    `<b>🏆 TON Bridge — Top Bridges ${date}</b>`,
    '',
    '<b>Top 3 by volume (last 24 h):</b>',
  ];

  for (const bridge of topBridges) {
    const pair = `${bridge.from.toUpperCase()} → ${bridge.to.toUpperCase()}`;
    lines.push(`${bridge.rank}. <b>${bridge.display}</b> bridged ${pair} — <b>${formatUsd(bridge.usd)}</b>`);
  }

  lines.push('');
  lines.push(`📊 <b>Total volume:</b> ${formatUsd(totalVolume)}`);
  lines.push(`🔄 <b>Total swaps:</b> ${totalSwaps}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// ChangeNOW data fetching
// ---------------------------------------------------------------------------

/**
 * Fetch yesterday's completed transactions from ChangeNOW partner API.
 * Returns an empty array if the request fails or the pair has no data.
 *
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function fetchTransactions(apiKey) {
  const now = Date.now();
  const msPerDay = 86_400_000;
  const dateFrom = new Date(now - msPerDay).toISOString();
  const dateTo   = new Date(now).toISOString();

  const url = new URL('https://api.changenow.io/v1/transactions');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('dateFrom', dateFrom);
  url.searchParams.set('dateTo',   dateTo);
  url.searchParams.set('limit', '500');

  const resp = await fetch(url.toString(), {
    headers: { 'x-changenow-api-key': apiKey },
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  return Array.isArray(data) ? data : (data.items ?? []);
}

/**
 * Aggregate raw transactions into the leaderboard shape.
 *
 * A transaction is expected to have at minimum:
 *   { userId, username, amountTo, toUsdRate, fromCurrency, toCurrency, status }
 *
 * Only "finished" / "success" transactions are counted.
 *
 * @param {Array}   transactions
 * @param {object}  kvNamespace    Cloudflare KV namespace (or null)
 * @returns {Promise<{topBridges, totalVolume, totalSwaps, popularFrom, popularTo}>}
 */
export async function aggregateLeaderboard(transactions, kvNamespace) {
  const finished = transactions.filter(tx =>
    tx.status === 'finished' || tx.status === 'success'
  );

  if (finished.length === 0) {
    return null; // signal: nothing to post
  }

  // Compute USD volume per transaction
  const enriched = await Promise.all(finished.map(async tx => {
    const usd = (Number(tx.amountTo) || 0) * (Number(tx.toUsdRate) || 0);
    const userId = tx.userId ?? tx.payinAddress ?? 'anon';

    // Determine display name: opt-in users show as @username, others as hash
    let display;
    if (kvNamespace && tx.userId) {
      const opted = await kvNamespace.get(`optin:${tx.userId}`);
      if (opted === '1' && tx.username) {
        display = `@${tx.username}`;
      }
    }
    if (!display) {
      display = 'User ' + await hashUserId(userId);
    }

    return {
      display,
      usd,
      from: tx.fromCurrency ?? '?',
      to:   tx.toCurrency   ?? '?',
    };
  }));

  // Sort descending by USD volume
  enriched.sort((a, b) => b.usd - a.usd);

  const topBridges = enriched.slice(0, 3).map((b, i) => ({ rank: i + 1, ...b }));

  const totalVolume = enriched.reduce((s, b) => s + b.usd, 0);
  const totalSwaps  = enriched.length;

  // Most popular pair by number of swaps
  const pairCount = {};
  for (const tx of enriched) {
    const key = `${tx.from}:${tx.to}`;
    pairCount[key] = (pairCount[key] ?? 0) + 1;
  }
  const popularPair = Object.entries(pairCount).sort((a, b) => b[1] - a[1])[0];
  const [popularFrom, popularTo] = (popularPair?.[0] ?? 'ton:bsc').split(':');

  return { topBridges, totalVolume, totalSwaps, popularFrom, popularTo };
}

// ---------------------------------------------------------------------------
// Telegram sender
// ---------------------------------------------------------------------------

/**
 * Send a message to the configured Telegram channel.
 *
 * @param {string} botToken
 * @param {string} channelId
 * @param {string} text        HTML-formatted message
 * @param {string} deepLink    URL for the inline-keyboard button
 * @returns {Promise<void>}
 */
export async function sendChannelMessage(botToken, channelId, text, deepLink) {
  const payload = {
    chat_id: channelId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🔀 Bridge now',
          url: deepLink,
        },
      ]],
    },
  };

  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram sendMessage failed: ${resp.status} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  /**
   * Cron handler — called by Cloudflare at 09:00 UTC daily.
   */
  async scheduled(_event, env, _ctx) {
    const botToken   = env.BOT_TOKEN;
    const channelId  = env.LEADERBOARD_CHANNEL_ID;
    const apiKey     = env.CHANGENOW_API_KEY;
    const kv         = env.LEADERBOARD_KV ?? null;

    if (!botToken || !channelId || !apiKey) {
      console.error('Missing required env vars: BOT_TOKEN, LEADERBOARD_CHANNEL_ID, CHANGENOW_API_KEY');
      return;
    }

    const transactions = await fetchTransactions(apiKey);
    const leaderboard  = await aggregateLeaderboard(transactions, kv);

    if (!leaderboard) {
      console.log('No completed swaps in the last 24 h — skipping post.');
      return;
    }

    const { topBridges, totalVolume, totalSwaps, popularFrom, popularTo } = leaderboard;

    const text     = buildMessage(topBridges, totalVolume, totalSwaps, popularFrom, popularTo);
    const deepLink = buildDeepLink(popularFrom, popularTo);

    await sendChannelMessage(botToken, channelId, text, deepLink);
    console.log(`Leaderboard posted to ${channelId}. Total swaps: ${totalSwaps}, volume: ${formatUsd(totalVolume)}`);
  },

  /**
   * HTTP handler — allows opt-in/opt-out via a simple webhook called from the
   * Telegram Mini App (Settings page).
   *
   * POST /optin   { userId, optIn: true|false }
   *   Requires header X-Telegram-Init-Data with the raw initData string for
   *   basic authenticity check (hash verification should be done server-side
   *   in production; this performs a presence check only).
   */
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/optin') {
      return new Response('Not Found', { status: 404 });
    }

    const initData = request.headers.get('X-Telegram-Init-Data');
    if (!initData) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const { userId, optIn } = body;
    if (!userId) {
      return new Response('Bad Request: userId required', { status: 400 });
    }

    const kv = env.LEADERBOARD_KV;
    if (!kv) {
      return new Response('Service Unavailable: KV not configured', { status: 503 });
    }

    if (optIn) {
      await kv.put(`optin:${userId}`, '1');
    } else {
      await kv.delete(`optin:${userId}`);
    }

    return new Response(JSON.stringify({ ok: true, userId, optIn: !!optIn }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
