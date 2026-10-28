'use strict';
/**
 * Boots OpenVibe.Surf on a random port against an in-process Network (test/helpers/network.js) and in-process
 * Live/Games/Actor stand-ins (test/helpers/upstreams.js), then returns a small HTTP client. Every test file gets
 * its own process, servers and app.
 *
 *   const t = await boot();
 *   t.get(path, { as: user, cookie, json, form, headers, method })
 *   t.signIn(user) → cookie header value (surf_at = a Network user token, as after /auth/callback)
 *   t.clock.advance(31_000) → move the feed/ride cache clock
 *   t.logs(), t.close()
 */
const http = require('http');
const { startNetwork } = require('./network');
const { startUpstreams } = require('./upstreams');

async function boot(opts = {}) {
    const network = await startNetwork();
    const upstreams = await startUpstreams();
    const env = {
        NODE_ENV: 'test', PORT: '0', BASE_URL: 'https://openvibe.surf', TRUST_PROXY: '1',
        OV_NETWORK_URL: network.url, OV_NETWORK_INTERNAL_URL: network.url, OV_NETWORK_ISSUER: network.url,
        OV_OAUTH_CLIENT_ID: 'surf', OV_OAUTH_CLIENT_SECRET: 'surf-secret', COOKIE_SECURE: 'false',
        SURF_RATE_LIMIT_PER_MIN: '100000',
        OV_LIVE_INTERNAL_URL: upstreams.url,
        OV_GAMES_INTERNAL_URL: upstreams.url,
        OV_ACTOR_INTERNAL_URL: upstreams.url,
        SURF_GAMES_PUBLIC_URL: 'https://openvibe.games',
        SURF_LIVE_PUBLIC_URL: 'https://openvibe.live',
        SURF_ACTOR_PUBLIC_URL: 'https://openvibe.actor',
        SURF_WATCH_SOURCE_TIMEOUT_MS: '500',
        SURF_GAMES_TIMEOUT_MS: '1000',
        SURF_ACTOR_TIMEOUT_MS: '1000',
        ...(opts.env || {}),
    };
    for (const [k, v] of Object.entries(opts.env || {})) if (v === null) delete env[k];

    const clock = {
        t: Date.now(),
        now() { return this.t; },
        advance(ms) { this.t += ms; },
    };

    const logLines = [];
    const log = {
        log: (...a) => logLines.push(a.map(String).join(' ')),
        info: (...a) => logLines.push(a.map(String).join(' ')),
        warn: (...a) => logLines.push(a.map(String).join(' ')),
        error: (...a) => logLines.push(a.map(String).join(' ')),
    };

    const configLib = require('../../server/config');
    const { createApp } = require('../../server/app');
    const config = configLib.load(env);
    const built = createApp({ config, log, now: () => clock.t });
    await built.ctx.keys.ensure();
    const server = await new Promise((resolve) => { const s = http.createServer(built.app); s.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;

    const signIn = (user) => `surf_at=${network.userToken(user)}`;

    async function get(p, o = {}) {
        const headers = { ...(o.headers || {}) };
        if (o.as) headers.cookie = [signIn(o.as), headers.cookie].filter(Boolean).join('; ');
        if (o.cookie) headers.cookie = o.cookie;
        let body = o.body;
        if (o.json !== undefined) { body = JSON.stringify(o.json); headers['content-type'] = 'application/json'; }
        if (o.form !== undefined) { body = new URLSearchParams(o.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
        const res = await fetch(base + p, { method: o.method || (body ? 'POST' : 'GET'), headers, body, redirect: 'manual' });
        const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
        return {
            status: res.status,
            headers: res.headers,
            text,
            json() { return JSON.parse(text); },
        };
    }

    return {
        base, network, upstreams, clock, config, ctx: built.ctx, get, signIn,
        logs: () => logLines.join('\n'),
        async close() {
            await new Promise((r) => server.close(r));
            built.ctx.keys.client.stop();
            await network.close();
            await upstreams.close();
        },
    };
}

let failures = 0;
async function check(name, fn) {
    try {
        await fn();
        process.stdout.write(`  ✓ ${name}\n`);
    } catch (e) {
        failures++;
        process.stdout.write(`  ✗ ${name}\n      ${(e.stack || String(e)).split('\n').slice(0, 10).join('\n      ')}\n`);
    }
}
function done() {
    process.stdout.write(failures ? `\n${failures} failed\n` : '\nall passed\n');
    process.exit(failures ? 1 : 0);
}

module.exports = { boot, check, done };
