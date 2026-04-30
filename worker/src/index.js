import { handleRedeem, handleBalance } from './redeemHandler.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        if (request.method === 'POST' && url.pathname === '/api/redeem') {
            return handleRedeem(request, env);
        }

        if (request.method === 'GET' && url.pathname === '/api/balance') {
            return handleBalance(request, env);
        }

        return new Response('Not found', { status: 404 });
    },
};
