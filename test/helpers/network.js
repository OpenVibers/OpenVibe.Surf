'use strict';
/**
 * An in-process stand-in for OpenVibe.Network: a real RS256 key pair and JWKS, /oauth/token with PKCE S256,
 * /oauth/revoke and an /api/health route. Every request is recorded so a test can assert what was (and was not)
 * called. setDown(true) makes every answer a 503.
 */
const http = require('http');
const crypto = require('crypto');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(claims, privateKey) {
    const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function listen(handler) {
    return new Promise((resolve) => {
        const sockets = new Set();
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks);
                const json = (status, obj, headers = {}) => {
                    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
                    res.end(JSON.stringify(obj));
                };
                Promise.resolve(handler(req, raw, json, res)).catch((err) => json(500, { error: String(err && err.message) }));
            });
        });
        server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            url: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
        }));
    });
}

async function startNetwork() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const st = {
        users: new Map(), codes: new Map(), refresh: new Map(),
        down: false, requests: [], tokenRequests: [],
    };
    let issuer = null;
    let nextUserId = 1;

    function addUser(username, { role = 'user' } = {}) {
        const u = { id: nextUserId++, subject: `usr_${crypto.randomBytes(12).toString('hex')}`, username, display_name: username, role };
        st.users.set(u.id, u);
        return u;
    }
    function userToken(u, { ttl = 3600 } = {}) {
        const now = Math.floor(Date.now() / 1000);
        return signJwt({ iss: issuer, sub: u.id, subject_id: u.subject, username: u.username, display_name: u.display_name, role: u.role, aud: ['openvibe.network'], iat: now, exp: now + ttl }, privatePem);
    }

    const srv = await listen(async (req, raw, json) => {
        const url = new URL(req.url, 'http://x');
        const text = raw.toString('utf8');
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
        st.requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization || null, body: text });
        if (st.down) return json(503, { error: 'Network is restarting' });

        if (url.pathname === '/api/health') return json(200, { status: 'ok', service: 'openvibe-network' });
        if (url.pathname === '/api/.well-known/jwks') return json(200, { public_key: publicPem, algorithm: 'RS256' });
        if (url.pathname === '/oauth/revoke') return json(200, {});
        if (url.pathname === '/oauth/token' && req.method === 'POST') {
            // The SDK sends application/json; the site's old module sent a form. Accept both.
            const form = String(req.headers['content-type'] || '').includes('json')
                ? (() => { try { return JSON.parse(text) || {}; } catch { return {}; } })()
                : Object.fromEntries(new URLSearchParams(text));
            st.tokenRequests.push(form);
            if (form.client_id !== 'surf' || form.client_secret !== 'surf-secret') return json(401, { error: 'invalid_client', error_description: 'bad client secret' });
            if (form.grant_type === 'authorization_code') {
                const c = st.codes.get(form.code);
                if (!c) return json(400, { error: 'invalid_grant', error_description: 'unknown code' });
                st.codes.delete(form.code);
                const challenge = crypto.createHash('sha256').update(String(form.code_verifier || '')).digest('base64url');
                if (challenge !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
                const rt = `rt_${crypto.randomBytes(12).toString('hex')}`;
                st.refresh.set(rt, c.user);
                return json(200, { access_token: userToken(c.user), refresh_token: rt, token_type: 'Bearer' });
            }
            if (form.grant_type === 'refresh_token') {
                const u = st.refresh.get(form.refresh_token);
                if (!u) return json(400, { error: 'invalid_grant', error_description: 'refresh token rejected' });
                st.refresh.delete(form.refresh_token);
                const rt = `rt_${crypto.randomBytes(12).toString('hex')}`;
                st.refresh.set(rt, u);
                return json(200, { access_token: userToken(u), refresh_token: rt, token_type: 'Bearer' });
            }
            return json(400, { error: 'unsupported_grant_type' });
        }
        return json(404, { error: 'not found' });
    });
    issuer = srv.url;

    return {
        url: srv.url, publicPem, privatePem, state: st,
        requests: st.requests, tokenRequests: st.tokenRequests,
        addUser, userToken,
        issueCode(user, challenge) { const code = `code_${crypto.randomBytes(8).toString('hex')}`; st.codes.set(code, { user, challenge }); return code; },
        setDown(v) { st.down = Boolean(v); },
        close: srv.close,
    };
}

module.exports = { startNetwork, signJwt };
