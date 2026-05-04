/**
 * Cloudflare Worker — CSP violation report collector.
 *
 * Deploy this worker and route /csp-report to it.
 * Violations are logged via console.log (visible in Workers logs)
 * and stored in a KV namespace named CSP_REPORTS (optional).
 *
 * Environment bindings (optional):
 *   CSP_REPORTS  – KV namespace for persistent storage
 *   MAX_BODY     – max bytes to read per report (default 4096)
 */

const MAX_BODY = 4096;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (
      !contentType.includes('application/csp-report') &&
      !contentType.includes('application/json')
    ) {
      return new Response('Unsupported Media Type', { status: 415 });
    }

    let body;
    try {
      body = await request.text();
      if (body.length > (env.MAX_BODY ?? MAX_BODY)) {
        body = body.slice(0, env.MAX_BODY ?? MAX_BODY) + '…[truncated]';
      }
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const report = {
      ts: new Date().toISOString(),
      ip: request.headers.get('cf-connecting-ip'),
      ua: request.headers.get('user-agent'),
      body,
    };

    console.log('CSP violation', JSON.stringify(report));

    if (env.CSP_REPORTS) {
      const key = `${report.ts}-${crypto.randomUUID()}`;
      await env.CSP_REPORTS.put(key, JSON.stringify(report), {
        expirationTtl: 60 * 60 * 24 * 30,
      });
    }

    return new Response(null, { status: 204, headers: corsHeaders() });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
