'use strict';
/**
 * Web: signed out 401, cross-site 403, the Actor call carries the person's Bearer and an Idempotency-Key and the
 * prefixed browsing brief, Actor's refusal passes through in words, and the plain form (POST /web/go, this site only) 303s to the Actor task page.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { PREFIX, taskText } = require('../server/web/tasks');

const ORIGIN = 'https://openvibe.surf';

(async () => {
    const t = await boot();
    const user = t.network.addUser('kim');
    const token = t.network.userToken(user);
    const signedIn = `surf_at=${token}`;

    await check('POST /api/v1/web/tasks is a 401 problem when signed out', async () => {
        const r = await t.get('/api/v1/web/tasks', { method: 'POST', json: { query: 'who runs the mail for openvibe.network' }, headers: { origin: ORIGIN } });
        assert.strictEqual(r.status, 401, r.text);
        assert.match(r.headers.get('content-type'), /application\/problem\+json/);
        assert.strictEqual(r.json().code, 'token.required');
        assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
    });

    await check('a cross-site Origin is 403 and never reaches Actor', async () => {
        t.upstreams.resetCounts();
        const r = await t.get('/api/v1/web/tasks', {
            cookie: signedIn, method: 'POST', json: { query: 'who runs the mail for openvibe.network' }, headers: { origin: 'https://evil.example' },
        });
        assert.strictEqual(r.status, 403, r.text);
        assert.strictEqual(r.json().code, 'web.cross_site');
        assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
        assert.strictEqual(t.upstreams.state.counts.actor, 0);
        const missing = await t.get('/api/v1/web/tasks', { cookie: signedIn, method: 'POST', json: { query: 'who runs the mail for openvibe.network' } });
        assert.strictEqual(missing.status, 403, 'no Origin is not this site');
    });

    await check('the task carries the person’s Bearer, an Idempotency-Key and the prefixed browsing brief', async () => {
        t.upstreams.resetCounts();
        const query = 'who runs the mail for openvibe.network and is SPF set up?';
        const r = await t.get('/api/v1/web/tasks', {
            cookie: signedIn, method: 'POST', json: { query }, headers: { origin: ORIGIN },
        });
        assert.strictEqual(r.status, 201, r.text);
        const b = r.json();
        assert.strictEqual(b.task_id, 'tsk_01J8SURFEXAMPLE00000000');
        assert.strictEqual(b.page, 'https://openvibe.actor/tasks/tsk_01J8SURFEXAMPLE00000000');
        assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
        assert.strictEqual(t.upstreams.state.counts.actor, 1);

        const sent = t.upstreams.lastFor('/api/v1/tasks');
        assert.strictEqual(sent.headers.authorization, `Bearer ${token}`);
        assert.match(sent.headers['idempotency-key'] || '', /^surf:web:[0-9a-f]{32}$/);
        const body = JSON.parse(sent.body);
        assert.strictEqual(body.task, taskText(query));
        assert.ok(body.task.startsWith(PREFIX), 'the standing brief comes first');
        assert.ok(body.task.endsWith(query), 'the person’s words are unchanged at the end');
        assert.match(body.task, /search_web/);
        assert.match(body.task, /read_page/);
        assert.match(body.task, /desk/);
        assert.match(body.task, /cites each source/);
        assert.strictEqual(body.idempotency_key, sent.headers['idempotency-key']);
        assert.ok(!t.logs().includes(token), 'the person’s token is never logged');
        assert.ok(!r.text.includes(token), 'the token is never echoed');
    });

    await check('a caller-supplied Idempotency-Key is passed through when it is valid', async () => {
        const r = await t.get('/api/v1/web/tasks', {
            cookie: signedIn, method: 'POST', json: { query: 'find a good surf forecast' }, headers: { origin: ORIGIN, 'idempotency-key': 'surf:web:caller-key-123' },
        });
        assert.strictEqual(r.status, 201, r.text);
        const sent = t.upstreams.lastFor('/api/v1/tasks');
        assert.strictEqual(sent.headers['idempotency-key'], 'surf:web:caller-key-123');
        assert.strictEqual(JSON.parse(sent.body).idempotency_key, 'surf:web:caller-key-123');
    });

    await check('a short, long or missing query is a 400 problem', async () => {
        for (const query of ['ab', 'x'.repeat(501), '', null]) {
            const r = await t.get('/api/v1/web/tasks', { cookie: signedIn, method: 'POST', json: { query }, headers: { origin: ORIGIN } });
            assert.strictEqual(r.status, 400, String(query));
            assert.strictEqual(r.json().code, 'web.invalid_query');
        }
    });

    await check('Actor’s refusal passes its status and words through', async () => {
        t.upstreams.state.actor.status = 429;
        t.upstreams.state.actor.problem = {
            type: 'about:blank', title: 'Too many tasks', status: 429, code: 'actor.allowance.exhausted',
            detail: 'The free tier runs 5 tasks a day; it resets at midnight UTC.',
        };
        const r = await t.get('/api/v1/web/tasks', { cookie: signedIn, method: 'POST', json: { query: 'surf the latest AI news' }, headers: { origin: ORIGIN } });
        t.upstreams.state.actor.status = 201;
        t.upstreams.state.actor.problem = null;
        assert.strictEqual(r.status, 429, r.text);
        const b = r.json();
        assert.strictEqual(b.code, 'actor.allowance.exhausted');
        assert.match(b.detail, /free tier runs 5 tasks a day/);
        assert.strictEqual(b.status, 429);
    });

    const own = { origin: 'https://openvibe.surf', 'sec-fetch-site': 'same-origin' };
    await check('POST /web/go (the plain form) creates the task and 303s to the Actor task page; the query is never in a URL', async () => {
        t.upstreams.resetCounts();
        const r = await t.get('/web/go', { cookie: signedIn, form: { q: 'find the best surf spots in Portugal' }, headers: own });
        assert.strictEqual(r.status, 303, r.text);
        assert.strictEqual(r.headers.get('location'), 'https://openvibe.actor/tasks/tsk_01J8SURFEXAMPLE00000000');
        assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
        const sent = t.upstreams.lastFor('/api/v1/tasks');
        assert.strictEqual(sent.headers.authorization, `Bearer ${token}`);
        assert.ok(JSON.parse(sent.body).task.includes('find the best surf spots in Portugal'));
        const get = await t.get('/web/go?q=find%20the%20best%20surf%20spots', { cookie: signedIn });
        assert.deepStrictEqual([get.status, get.headers.get('location')], [303, '/web'], 'a GET starts nothing: it goes back to the form');
    });

    await check('POST /web/go sends a guest to sign in, refuses a bad query and another site', async () => {
        const guest = await t.get('/web/go', { form: { q: 'find the best surf spots' }, headers: own });
        assert.strictEqual(guest.status, 303);
        assert.strictEqual(guest.headers.get('location'), '/auth/login?next=%2Fweb');
        const bad = await t.get('/web/go', { cookie: signedIn, form: { q: 'ab' }, headers: own });
        assert.strictEqual(bad.status, 400);
        assert.match(bad.text, /id="sf-web-form"/, 'the form again, with what was typed');
        const cross = await t.get('/web/go', { cookie: signedIn, form: { q: 'find the best surf spots' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
        assert.strictEqual(cross.status, 403);
    });

    await check('POST /web/go passes Actor’s refusal through in words', async () => {
        t.upstreams.state.actor.status = 429;
        t.upstreams.state.actor.problem = { code: 'actor.allowance.exhausted', detail: 'The free tier runs 5 tasks a day; it resets at midnight UTC.' };
        const r = await t.get('/web/go', { cookie: signedIn, form: { q: 'find the best surf spots' }, headers: own });
        t.upstreams.state.actor.status = 201;
        t.upstreams.state.actor.problem = null;
        assert.strictEqual(r.status, 429);
        assert.match(r.text, /free tier runs 5 tasks a day/);
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
