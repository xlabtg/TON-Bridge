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

const ALLOWED_ORIGINS = [
  'https://tonbankcard.com',
  'http://localhost',
  'http://localhost:8080',
  'http://127.0.0.1',
];

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

      const { initData } = body || {};
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
      const payload = {
        sub: String(id || ''),
        username: username || '',
        language_code: language_code || '',
        iat: nowS,
        exp: expiresAt,
      };

      const token = await signJWT(payload, env.JWT_SECRET);

      const responseBody = JSON.stringify({
        token,
        expiresAt,
        user: { id, username, language_code },
      });

      return new Response(responseBody, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response(null, { status: 404, headers: cors });
  },
};
