/**
 * Cloudflare Worker — TON Bridge notification dispatcher
 *
 * Responsibilities:
 *   - POST /auth/verify  : record telegram_user_id + last_seen + notification_opt_out
 *   - Cron (every 60 s) : poll ChangeNOW for in-flight orders and send Telegram
 *                         messages on terminal-state transitions.
 *
 * KV namespace binding  : BRIDGE_KV
 * Secrets (via wrangler secrets):
 *   TELEGRAM_BOT_TOKEN  : bot token from @BotFather
 *   CHANGENOW_API_KEY   : ChangeNOW partner API key
 */

// ─── Terminal / non-terminal state sets ───────────────────────────────────────

/** Orders in these states are still being processed — poll them. */
export const POLLING_STATES = new Set(['confirming', 'exchanging', 'sending']);

/** Orders that have reached a final state — notify then stop polling. */
export const TERMINAL_STATES = new Set(['finished', 'failed', 'refunded']);

// ─── i18n notification texts ──────────────────────────────────────────────────

const MESSAGES = {
  finished: {
    en: '✅ Your TON has arrived. View order →',
    ru: '✅ TON получены. Открыть заказ →',
  },
  failed: {
    en: '⚠️ Exchange refunded — tap to see details',
    ru: '⚠️ Обмен отменён — нажмите, чтобы увидеть детали',
  },
  refunded: {
    en: '⚠️ Exchange refunded — tap to see details',
    ru: '⚠️ Обмен отменён — нажмите, чтобы увидеть детали',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the notification text for a terminal state.
 * @param {string} state  - ChangeNOW terminal state
 * @param {string} lang   - 'ru' | anything else → EN
 */
export function getNotificationText(state, lang = 'en') {
  const bucket = MESSAGES[state];
  if (!bucket) return null;
  return lang === 'ru' ? bucket.ru : bucket.en;
}

/**
 * Build the deep-link back into the order inside the TMA.
 * @param {string} orderId
 */
export function buildDeepLink(orderId) {
  return `https://t.me/TONBridge_robot/app?startapp=order_${orderId}`;
}

/**
 * Detect whether a state transition should trigger a notification.
 * Idempotent: returns false if the order was already notified.
 * @param {string|null} previousState - last known state (null = first poll)
 * @param {string}      currentState
 * @param {boolean}     alreadyNotified
 */
export function shouldNotify(previousState, currentState, alreadyNotified) {
  if (alreadyNotified) return false;
  if (!TERMINAL_STATES.has(currentState)) return false;
  // Only fire on an actual transition (previousState was non-terminal or unknown)
  if (previousState && TERMINAL_STATES.has(previousState)) return false;
  return true;
}

// ─── Telegram Bot API ─────────────────────────────────────────────────────────

/**
 * Send a Telegram message via Bot API.
 * @param {string} botToken
 * @param {string|number} chatId
 * @param {string} text
 * @param {string} url - inline-keyboard button URL
 */
export async function sendTelegramMessage(botToken, chatId, text, url) {
  const payload = {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: '→ Open', url }]],
    },
  };
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── ChangeNOW API ────────────────────────────────────────────────────────────

/**
 * Fetch current status of a ChangeNOW order.
 * @param {string} apiKey
 * @param {string} orderId
 */
export async function fetchOrderStatus(apiKey, orderId) {
  const url = `https://api.changenow.io/v1/transactions/${orderId}/${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ChangeNOW API error ${res.status} for order ${orderId}`);
  }
  const data = await res.json();
  return data.status; // e.g. 'confirming', 'exchanging', 'finished', …
}

// ─── Cron handler ─────────────────────────────────────────────────────────────

/**
 * Poll all in-flight orders stored in KV and dispatch notifications.
 * Called from the scheduled event handler.
 * @param {KVNamespace} kv
 * @param {string} botToken
 * @param {string} apiKey
 */
export async function runNotificationCron(kv, botToken, apiKey) {
  // List all orders currently being tracked  (prefix "order:")
  const { keys } = await kv.list({ prefix: 'order:' });
  const results = [];

  // Process in batches to stay well under Telegram's 30 msg/s rate limit.
  // 10 parallel requests gives headroom even if every order fires a message.
  const BATCH = 10;
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(({ name }) => processOrder(name, kv, botToken, apiKey))
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Process a single order key from KV.
 * @param {string} kvKey       - e.g. "order:<orderId>"
 * @param {KVNamespace} kv
 * @param {string} botToken
 * @param {string} apiKey
 */
async function processOrder(kvKey, kv, botToken, apiKey) {
  const raw = await kv.get(kvKey, 'json');
  if (!raw) return { kvKey, action: 'missing' };

  const { orderId, telegramUserId, lang, lastState, notified } = raw;

  // Skip users who opted out
  if (raw.notificationsOptOut) return { kvKey, action: 'opted-out' };

  // Skip users we haven't seen recently (> 30 days) to avoid 403s
  const lastSeen = raw.lastSeen ? new Date(raw.lastSeen) : null;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (!lastSeen || lastSeen.getTime() < thirtyDaysAgo) {
    return { kvKey, action: 'stale-user' };
  }

  let currentState;
  try {
    currentState = await fetchOrderStatus(apiKey, orderId);
  } catch (err) {
    return { kvKey, action: 'fetch-error', error: err.message };
  }

  if (shouldNotify(lastState, currentState, notified)) {
    const text = getNotificationText(currentState, lang);
    const url = buildDeepLink(orderId);
    try {
      await sendTelegramMessage(botToken, telegramUserId, text, url);
    } catch (err) {
      // Update state even if notification fails to avoid re-sending on retry
      await kv.put(kvKey, JSON.stringify({ ...raw, lastState: currentState }));
      return { kvKey, action: 'notify-error', error: err.message };
    }
    // Mark notified + update last seen state
    await kv.put(
      kvKey,
      JSON.stringify({ ...raw, lastState: currentState, notified: true })
    );
    return { kvKey, action: 'notified', state: currentState };
  }

  // Update state without notifying (still in-flight or already notified)
  if (currentState !== lastState) {
    await kv.put(kvKey, JSON.stringify({ ...raw, lastState: currentState }));
  }

  // Remove orders that have settled and are already notified
  if (TERMINAL_STATES.has(currentState) && notified) {
    await kv.delete(kvKey);
    return { kvKey, action: 'cleaned-up' };
  }

  return { kvKey, action: 'polled', state: currentState };
}

// ─── HTTP request handler ─────────────────────────────────────────────────────

/**
 * Handle POST /auth/verify — store user metadata and register the order.
 *
 * Expected JSON body:
 * {
 *   telegramUserId: string | number,
 *   orderId: string,
 *   lang: 'en' | 'ru',
 *   notificationsOptOut: boolean   // from CloudStorage toggle
 * }
 */
async function handleVerify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { telegramUserId, orderId, lang, notificationsOptOut } = body;
  if (!telegramUserId || !orderId) {
    return new Response(
      JSON.stringify({ error: 'telegramUserId and orderId are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const record = {
    orderId,
    telegramUserId: String(telegramUserId),
    lang: lang === 'ru' ? 'ru' : 'en',
    notificationsOptOut: Boolean(notificationsOptOut),
    lastSeen: new Date().toISOString(),
    lastState: null,
    notified: false,
  };

  await env.BRIDGE_KV.put(`order:${orderId}`, JSON.stringify(record));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Worker entry-point ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/auth/verify') {
      return handleVerify(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runNotificationCron(
        env.BRIDGE_KV,
        env.TELEGRAM_BOT_TOKEN,
        env.CHANGENOW_API_KEY
      )
    );
  },
};
