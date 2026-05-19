import leaderboardWorker from '../leaderboard.js';
import { handleAdminReplay, runScheduledAccrual } from './accrualJob.js';
import { handleAdminPanelRequest } from './adminPanel.js';
import { handleBalance, handleRedeem } from './redeemHandler.js';

/**
 * Cloudflare Worker — POST /auth/verify
 *
 * Validates Telegram WebApp initData (HMAC-SHA-256) and issues a short-lived
 * JWT.  See https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Required secrets (set via `wrangler secret put`):
 *   BOT_TOKEN  — Telegram bot token
 *   JWT_SECRET — random secret for signing JWTs (≥ 32 bytes)
 *
 * Required bindings (wrangler.toml):
 *   [[unsafe.bindings]]          — RateLimit (name = "RATE_LIMITER")
 */

const MAX_AUTH_DATE_AGE_S = 24 * 60 * 60; // 24 h
const TOKEN_TTL_S = 60 * 60;              // 1 h
const MAX_LAST_SEEN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATION_BATCH_SIZE = 10;
const REF_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REF_CODE_LENGTH = 8;
const REF_CODE_MAX_ATTEMPTS = 5;

export const POLLING_STATES = new Set(['confirming', 'exchanging', 'sending']);
export const TERMINAL_STATES = new Set(['finished', 'failed', 'refunded']);

const ALLOWED_ORIGINS = [
  'https://tonbankcard.com',
  'http://localhost',
  'http://localhost:8080',
  'http://127.0.0.1',
];

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

// ──────────────────────────────────────────────────────────────────────────────
// HMAC helpers (Web Crypto API, available in the Workers runtime)
// ──────────────────────────────────────────────────────────────────────────────

function encodeUTF8(str) {
  return new TextEncoder().encode(str);
}

async function hmacSHA256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encodeUTF8(data));
  return new Uint8Array(sig);
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derives the secret key per the Telegram spec:
 *   secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
 */
async function deriveSecretKey(botToken) {
  return hmacSHA256(encodeUTF8('WebAppData'), botToken);
}

/**
 * Validates initData string and returns the parsed fields on success.
 * Throws if validation fails.
 */
export async function validateInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('missing hash');

  // Build the data-check string: all fields except 'hash', sorted, joined by '\n'
  const entries = [];
  for (const [k, v] of params.entries()) {
    if (k !== 'hash') entries.push(`${k}=${v}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = await deriveSecretKey(botToken);
  const computed = await hmacSHA256(secretKey, dataCheckString);
  const computedHex = toHex(computed);

  if (computedHex !== receivedHash) throw new Error('invalid hash');

  // Reject stale initData
  const authDate = Number(params.get('auth_date'));
  if (!authDate) throw new Error('missing auth_date');
  const nowS = Math.floor(Date.now() / 1000);
  if (nowS - authDate > MAX_AUTH_DATE_AGE_S) throw new Error('initData expired');

  // Parse user field
  const userRaw = params.get('user');
  let user = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      throw new Error('invalid user JSON');
    }
  }

  return { user, authDate, params };
}

// ──────────────────────────────────────────────────────────────────────────────
// Minimal JWT (HS256) — avoids a dependency on a JWT library
// ──────────────────────────────────────────────────────────────────────────────

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = s => b64url(encodeUTF8(JSON.stringify(s)));
  const unsigned = `${enc(header)}.${enc(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encodeUTF8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encodeUTF8(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

export function getNotificationText(state, lang = 'en') {
  const bucket = MESSAGES[state];
  if (!bucket) return null;
  return lang === 'ru' ? bucket.ru : bucket.en;
}

export function buildDeepLink(orderId) {
  return `https://t.me/TONBridge_robot/app?startapp=order_${orderId}`;
}

export function buildReferralShareUrl(refCode) {
  return `https://t.me/TONBridge_robot/app?startapp=ref_${refCode}`;
}

export function generateRefCode() {
  const bytes = new Uint8Array(REF_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += REF_CODE_ALPHABET[byte % REF_CODE_ALPHABET.length];
  }
  return code;
}

async function getOrCreateUser(db, user, nowS, logger = console) {
  if (!db || !user || !user.id) return null;

  const telegramId = Number(user.id);
  const existing = await db
    .prepare('SELECT telegram_id, ref_code, referred_by, ton_address FROM users WHERE telegram_id = ?')
    .bind(telegramId)
    .first();

  if (existing) {
    await db
      .prepare('UPDATE users SET last_seen = ? WHERE telegram_id = ?')
      .bind(nowS, telegramId)
      .run();
    return existing;
  }

  for (let attempt = 1; attempt <= REF_CODE_MAX_ATTEMPTS; attempt += 1) {
    const refCode = generateRefCode();
    try {
      await db
        .prepare('INSERT INTO users (telegram_id, ref_code, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .bind(telegramId, refCode, nowS, nowS)
        .run();

      const created = await db
        .prepare('SELECT telegram_id, ref_code, referred_by, ton_address FROM users WHERE telegram_id = ?')
        .bind(telegramId)
        .first();

      if (created && created.ref_code === refCode) {
        return created;
      }

      if (created) {
        return created;
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const isRefCodeCollision = /unique|constraint|ref_code/i.test(message);
      if (!isRefCodeCollision || attempt === REF_CODE_MAX_ATTEMPTS) {
        logger.error('failed to create user referral code', {
          telegramId,
          attempt,
          error: message,
        });
        throw err;
      }
    }
  }

  logger.error('failed to create unique referral code after max attempts', { telegramId });
  throw new Error('ref_code collision limit reached');
}

export function shouldNotify(previousState, currentState, alreadyNotified) {
  if (alreadyNotified) return false;
  if (!TERMINAL_STATES.has(currentState)) return false;
  if (previousState && TERMINAL_STATES.has(previousState)) return false;
  return true;
}

export async function sendTelegramMessage(botToken, chatId, text, url) {
  const payload = {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: '→ Open', url }]],
    },
  };

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }

  return res.json();
}

export async function fetchOrderStatus(apiKey, orderId) {
  const res = await fetch(`https://api.changenow.io/v1/transactions/${orderId}/${apiKey}`);
  if (!res.ok) {
    throw new Error(`ChangeNOW API error ${res.status} for order ${orderId}`);
  }
  const data = await res.json();
  return data.status;
}

async function processOrder(kvKey, kv, botToken, apiKey) {
  const raw = await kv.get(kvKey, 'json');
  if (!raw) return { kvKey, action: 'missing' };
  if (raw.notificationsOptOut) return { kvKey, action: 'opted-out' };

  const lastSeen = raw.lastSeen ? new Date(raw.lastSeen) : null;
  if (!lastSeen || lastSeen.getTime() < Date.now() - MAX_LAST_SEEN_AGE_MS) {
    return { kvKey, action: 'stale-user' };
  }

  const { orderId, telegramUserId, lang, lastState, notified } = raw;
  let currentState;
  try {
    currentState = await fetchOrderStatus(apiKey, orderId);
  } catch (err) {
    return { kvKey, action: 'fetch-error', error: err.message };
  }

  if (shouldNotify(lastState, currentState, notified)) {
    const text = getNotificationText(currentState, lang);
    try {
      await sendTelegramMessage(botToken, telegramUserId, text, buildDeepLink(orderId));
    } catch (err) {
      await kv.put(kvKey, JSON.stringify({ ...raw, lastState: currentState }));
      return { kvKey, action: 'notify-error', error: err.message };
    }

    await kv.put(kvKey, JSON.stringify({ ...raw, lastState: currentState, notified: true }));
    return { kvKey, action: 'notified', state: currentState };
  }

  if (currentState !== lastState) {
    await kv.put(kvKey, JSON.stringify({ ...raw, lastState: currentState }));
  }

  if (TERMINAL_STATES.has(currentState) && notified) {
    await kv.delete(kvKey);
    return { kvKey, action: 'cleaned-up' };
  }

  return { kvKey, action: 'polled', state: currentState };
}

export async function runNotificationCron(kv, botToken, apiKey) {
  const { keys } = await kv.list({ prefix: 'order:' });
  const results = [];

  for (let i = 0; i < keys.length; i += NOTIFICATION_BATCH_SIZE) {
    const batch = keys.slice(i, i + NOTIFICATION_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(({ name }) => processOrder(name, kv, botToken, apiKey)),
    );
    results.push(...batchResults);
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// CORS helpers
// ──────────────────────────────────────────────────────────────────────────────

function getAllowedOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  for (const allowed of ALLOWED_ORIGINS) {
    if (requestOrigin === allowed || requestOrigin.startsWith(allowed + ':')) {
      return requestOrigin;
    }
  }
  return null;
}

function corsHeaders(requestOrigin) {
  const origin = getAllowedOrigin(requestOrigin) || ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main fetch handler
// ──────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);

    // Pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/auth/verify') {
      // Rate limit
      if (env.RATE_LIMITER) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return new Response(null, { status: 429, headers: cors });
        }
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(null, { status: 400, headers: cors });
      }

      const { initData, orderId, notificationsOptOut } = body || {};
      if (!initData || typeof initData !== 'string') {
        return new Response(null, { status: 400, headers: cors });
      }

      let parsed;
      try {
        parsed = await validateInitData(initData, env.BOT_TOKEN);
      } catch {
        return new Response(null, { status: 401, headers: cors });
      }

      const nowS = Math.floor(Date.now() / 1000);
      const expiresAt = nowS + TOKEN_TTL_S;

      const { id, username, language_code } = parsed.user || {};
      let dbUser = null;
      try {
        dbUser = await getOrCreateUser(env.DB, parsed.user, nowS);
      } catch {
        return new Response(null, { status: 500, headers: cors });
      }

      const payload = {
        sub: String(id || ''),
        username: username || '',
        language_code: language_code || '',
        ref_code: dbUser ? dbUser.ref_code : '',
        iat: nowS,
        exp: expiresAt,
      };

      const token = await signJWT(payload, env.JWT_SECRET);

      if (orderId && env.BRIDGE_KV) {
        await env.BRIDGE_KV.put(`order:${orderId}`, JSON.stringify({
          orderId,
          telegramUserId: String(id || ''),
          lang: language_code === 'ru' ? 'ru' : 'en',
          notificationsOptOut: Boolean(notificationsOptOut),
          lastSeen: new Date().toISOString(),
          lastState: null,
          notified: false,
        }));
      }

      const responseBody = JSON.stringify({
        token,
        expiresAt,
        user: {
          id,
          username,
          language_code,
          ref_code: dbUser ? dbUser.ref_code : null,
          ref_share_url: dbUser ? buildReferralShareUrl(dbUser.ref_code) : null,
        },
      });

      return new Response(responseBody, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/redeem') {
      return handleRedeem(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/balance') {
      return handleBalance(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/admin/replay') {
      return handleAdminReplay(request, url, env);
    }

    // Admin panel endpoints (issue #121). Authenticated via Telegram
    // initData; authorised against env.ADMIN_TELEGRAM_IDS allow-list.
    if (url.pathname.startsWith('/admin/api/')) {
      const adminResponse = await handleAdminPanelRequest(request, url, env);
      if (adminResponse) {
        // Merge CORS headers into the admin response.
        const merged = new Headers(adminResponse.headers);
        for (const [k, v] of Object.entries(cors)) merged.set(k, v);
        return new Response(adminResponse.body, {
          status: adminResponse.status,
          headers: merged,
        });
      }
    }

    if (new URL(request.url).pathname === '/optin') {
      return leaderboardWorker.fetch(request, env);
    }

    return new Response(null, { status: 404, headers: cors });
  },

  async scheduled(event, env, ctx) {
    if (env.BRIDGE_KV && env.BOT_TOKEN && env.CHANGENOW_API_KEY) {
      ctx.waitUntil(runNotificationCron(env.BRIDGE_KV, env.BOT_TOKEN, env.CHANGENOW_API_KEY));
    }

    if (event.cron === '* * * * *' && env.DB && env.CHANGENOW_API_KEY) {
      ctx.waitUntil(runScheduledAccrual(env));
    }

    if (event.cron === '0 9 * * *') {
      ctx.waitUntil(leaderboardWorker.scheduled(event, env, ctx));
    }
  },
};
