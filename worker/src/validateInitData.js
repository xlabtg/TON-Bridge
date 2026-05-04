// Validate Telegram WebApp initData using HMAC-SHA256.
// Returns the parsed user object on success, throws on failure.
export async function validateInitData(initDataRaw, botToken) {
    if (!initDataRaw) throw new Error('missing_init_data');

    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) throw new Error('missing_hash');

    params.delete('hash');

    // Sort keys and build data-check string
    const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');

    const enc = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
        'raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const hmacKey = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken));

    const verifyKey = await crypto.subtle.importKey(
        'raw', hmacKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', verifyKey, enc.encode(dataCheckString));

    const computedHash = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    if (computedHash !== hash) throw new Error('invalid_hash');

    const userStr = params.get('user');
    if (!userStr) throw new Error('missing_user');
    return JSON.parse(userStr);
}
