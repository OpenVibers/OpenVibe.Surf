'use strict';
/**
 * Sign-in: sanitizeNext (open-redirect regressions), the login redirect (PKCE S256, state, client id, redirect
 * URI), the callback (state mismatch refused, httpOnly cookies), /auth/me signed out and in, and sign-out.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { sanitizeNext } = require('../server/auth/sso');

const config = { baseUrl: 'https://openvibe.surf' };
const cookies = (r) => (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']);
const cookieNamed = (r, name) => {
    for (const c of cookies(r)) {
        const m = new RegExp(`(?:^|[,\\s])${name}=([^;]+)`).exec(c);
        if (m) return `${name}=${m[1]}`;
    }
    return null;
};

(async () => {
    // ── sanitizeNext: same-site paths only ──
    for (const v of ['//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'http:evil.com', '/\t/evil.com',
        '/\n/evil.com', '\t//evil.com', ' //evil.com', '/\\/evil.com', 'https:/\\evil.com', '///evil.com',
        'javascript:alert(1)', null, '', 12]) {
        assert.strictEqual(sanitizeNext(v, config), '/', `${JSON.stringify(v)} goes home`);
    }
    assert.strictEqual(sanitizeNext('/watch?topic=live', config), '/watch?topic=live');
    assert.strictEqual(sanitizeNext('https://openvibe.surf/ride/surf_lagoon?x=1#c', config), '/ride/surf_lagoon?x=1#c');
    for (const v of ['https://evil.com/a', 'https://openvibe.surf.evil.com/a', 'https://openvibe.surf@evil.com/', 'http://openvibe.surf/a']) {
        assert.strictEqual(sanitizeNext(v, config), '/', v);
    }

    const t = await boot();
    const user = t.network.addUser('kim');

    await check('login redirects to Network with state, client id surf and an S256 challenge', async () => {
        const r = await t.get('/auth/login?next=/web');
        assert.strictEqual(r.status, 302);
        const loc = new URL(r.headers.get('location'));
        assert.strictEqual(loc.origin + loc.pathname, `${t.network.url}/oauth/authorize`);
        assert.strictEqual(loc.searchParams.get('client_id'), 'surf');
        assert.strictEqual(loc.searchParams.get('response_type'), 'code');
        assert.strictEqual(loc.searchParams.get('redirect_uri'), 'https://openvibe.surf/auth/callback');
        assert.strictEqual(loc.searchParams.get('scope'), 'profile');
        assert.strictEqual(loc.searchParams.get('code_challenge_method'), 'S256');
        assert.match(loc.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
        assert.match(loc.searchParams.get('state'), /^[A-Za-z0-9_-]{32}$/);
        const all = cookies(r).join('\n');
        assert.match(all, /ov_oauth_state=[^;]+;.*Path=\/auth.*HttpOnly/i);
        assert.match(all, /ov_oauth_verifier=[^;]+;.*Path=\/auth.*HttpOnly/i);
        const next = cookieNamed(r, 'ov_oauth_next');
        assert.ok(next, 'the page to return to is set');
        assert.strictEqual(decodeURIComponent(next.split('=')[1]), '/web');
    });

    await check('silent sign-in adds prompt=none and next= only keeps this site', async () => {
        const r = await t.get('/auth/login?silent=1&next=' + encodeURIComponent('https://evil.example/x'));
        const loc = new URL(r.headers.get('location'));
        assert.strictEqual(loc.searchParams.get('prompt'), 'none');
        const offSite = cookieNamed(r, 'ov_oauth_next');
        assert.ok(!offSite, 'another origin is not remembered as next');
        const own = await t.get('/auth/login?next=' + encodeURIComponent('https://openvibe.surf/ride/surf_lagoon?x=1'));
        const ownNext = cookieNamed(own, 'ov_oauth_next');
        assert.ok(ownNext, 'this site\'s own page is remembered');
        assert.strictEqual(decodeURIComponent(ownNext.split('=')[1]), '/ride/surf_lagoon?x=1');
    });

    await check('the callback exchanges the code and sets httpOnly ov_token/ov_refresh cookies', async () => {
        const login = await t.get('/auth/login?next=/web');
        const loc = new URL(login.headers.get('location'));
        const flowCookie = cookies(login).map((c) => c.split(';')[0]).join('; ');
        const code = t.network.issueCode(user, loc.searchParams.get('code_challenge'));
        const r = await t.get(`/auth/callback?code=${code}&state=${loc.searchParams.get('state')}`, { cookie: flowCookie });
        assert.strictEqual(r.status, 302, r.text);
        assert.strictEqual(r.headers.get('location'), '/web');
        const all = cookies(r).join('\n');
        assert.match(all, /ov_token=[^;]+;.*HttpOnly/i);
        assert.match(all, /ov_refresh=[^;]+;.*HttpOnly/i);
        assert.match(all, /surf_at=;/, 'the legacy access cookie is cleared once the SDK session is written');
        assert.ok(!/SameSite=None/i.test(all), 'SameSite=Lax, not None');
        const at = cookieNamed(r, 'ov_token');
        assert.ok(at, 'the access cookie is set');
        const me = await t.get('/auth/me', { cookie: at });
        assert.strictEqual(me.status, 200);
        assert.strictEqual(me.json().user.username, 'kim');
        assert.ok(!me.text.includes(at.split('=')[1]), '/auth/me never returns the token');
        const tokenRequest = t.network.tokenRequests[t.network.tokenRequests.length - 1];
        assert.strictEqual(tokenRequest.client_id, 'surf');
        assert.strictEqual(tokenRequest.grant_type, 'authorization_code');
        assert.strictEqual(tokenRequest.redirect_uri, 'https://openvibe.surf/auth/callback');
        assert.ok(tokenRequest.code_verifier, 'the verifier is sent server-side');
    });

    await check('a lost flow or a wrong state recovers once, then shows the page', async () => {
        const login = await t.get('/auth/login');
        const loc = new URL(login.headers.get('location'));
        const flowCookie = cookies(login).map((c) => c.split(';')[0]).join('; ');
        const code = t.network.issueCode(user, loc.searchParams.get('code_challenge'));
        const bad = await t.get(`/auth/callback?code=${code}&state=${'0'.repeat(32)}`, { cookie: flowCookie });
        assert.strictEqual(bad.status, 302, 'the sign-in starts once more');
        assert.strictEqual(bad.headers.get('location'), '/auth/login');
        const badAgain = await t.get(`/auth/callback?code=${code}&state=${'0'.repeat(32)}`, { cookie: 'ov_oauth_retry=1' });
        assert.strictEqual(badAgain.status, 400, 'the second failure shows the page');
        assert.match(badAgain.text, /Try again/);
        const noCookie = await t.get(`/auth/callback?code=${code}&state=${loc.searchParams.get('state')}`);
        assert.strictEqual(noCookie.status, 302, 'a lost flow cookie starts the sign-in once more');
        const none = await t.get('/auth/callback?state=x');
        assert.strictEqual(none.status, 400, 'no code at all is the page, not a retry');
    });

    await check('/auth/me is null for a guest and for a cookie that does not verify (the SDK shape)', async () => {
        const guest = await t.get('/auth/me');
        assert.strictEqual(guest.status, 200);
        assert.deepStrictEqual(guest.json(), { user: null });
        const bad = await t.get('/auth/me', { cookie: 'surf_at=not-a-token' });
        assert.strictEqual(bad.status, 200);
        assert.deepStrictEqual(bad.json(), { user: null });
    });

    await check('sign-out clears the cookies and returns to next', async () => {
        const r = await t.get('/auth/logout?next=%2Fwatch', { headers: { 'sec-fetch-site': 'same-origin' } });
        assert.strictEqual(r.status, 303);
        assert.strictEqual(r.headers.get('location'), '/watch');
        assert.match(cookies(r).join('\n'), /surf_at=;/);
    });

    await check('the token is never logged', async () => {
        const token = t.network.userToken(user);
        assert.ok(!t.logs().includes(token), 'no access token in the logs');
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
