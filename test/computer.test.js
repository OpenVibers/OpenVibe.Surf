'use strict';
/**
 * The Computer on Surf's task card (plan 2026-11-07: "Surf, Computer and Actor are one experience"): the card reads
 * the task's computer (machine, where, cost_hint, driving), shows its still from a same-origin proxy (the person's
 * token stays in the cookie), and Take over / Give it back are one API on the task at Actor.
 *   node test/computer.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

const ORIGIN = 'https://openvibe.surf';
const DESK = `https://openvibe.bot/machines/dev_${'A'.repeat(26)}/screen?desk=desk-surf`;
const COMPUTER = { session_id: 'ses_01JAB2C3D4E5F6G7H8J9K0MNPQR', machine: 'a shared desk host', where: 'network', cost_hint: 'a desk host, metered by the minute', driving: false };

(async () => {
    const t = await boot();
    const kim = t.network.addUser('kim');
    const token = t.network.userToken(kim);
    const signedIn = `surf_at=${token}`;
    const id = t.upstreams.state.actor.id;
    t.upstreams.state.actor.task = { id, state: 'running', task: 'Compare three hosting plans', computer: { ...COMPUTER }, desk: { url: DESK, kind: 'browser' } };

    try {
        await check('the card reads the one Computer and shows the still slot', async () => {
            const r = await t.get(`/web/t/${id}`, { cookie: signedIn });
            assert.strictEqual(r.status, 200, r.text);
            assert.match(r.text, /class="ov-task-still"/);
            assert.match(r.text, new RegExp(`data-src="/api/v1/web/tasks/${id}/still"`));
            assert.match(r.text, /a shared desk host/);
            assert.match(r.text, /metered by the minute/);
            assert.match(r.text, /data-sf-desk-takeover-form/);
            assert.match(r.text, new RegExp(`action="/api/v1/web/tasks/${id}/takeover"`));
            assert.match(r.text, /data-sf-desk-giveback-form hidden/);
            assert.ok(!r.text.includes(token), 'the token is never rendered');
        });

        await check('the still is a same-origin proxy, no-store, with the person\'s Bearer at Actor', async () => {
            const r = await t.get(`/api/v1/web/tasks/${id}/still`, { cookie: signedIn });
            assert.strictEqual(r.status, 200, r.text);
            assert.match(r.headers.get('content-type'), /^image\/jpeg/);
            assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
            assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
            assert.deepStrictEqual(r.buffer, Buffer.from('/9j/4AAQ', 'base64'));
            const sent = t.upstreams.lastFor(`/api/v1/tasks/${id}/still`);
            assert.strictEqual(sent.headers.authorization, `Bearer ${token}`);
            assert.strictEqual((await t.get(`/api/v1/web/tasks/${id}/still`)).status, 401, 'signed out');
        });

        await check('another person\'s task is the same 404 as a missing one', async () => {
            t.upstreams.state.actor.stillStatus = 404;
            const r = await t.get(`/api/v1/web/tasks/${id}/still`, { cookie: signedIn });
            assert.strictEqual(r.status, 404);
            assert.match(r.text, /No picture/);
        });

        await check('Take over calls the one API and goes to the desk; Give it back returns to the task', async () => {
            t.upstreams.state.actor.stillStatus = 200;
            assert.strictEqual((await t.get(`/api/v1/web/tasks/${id}/takeover`, { cookie: signedIn, method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403, 'another site');
            const take = await t.get(`/api/v1/web/tasks/${id}/takeover`, { cookie: signedIn, method: 'POST', headers: { origin: ORIGIN } });
            assert.strictEqual(take.status, 303, take.text);
            assert.strictEqual(take.headers.get('location'), DESK, 'the person drives on the desk\'s own page');
            const sent = t.upstreams.lastFor(`/api/v1/tasks/${id}/takeover`);
            assert.strictEqual(sent.headers.authorization, `Bearer ${token}`);
            assert.deepStrictEqual(t.upstreams.state.actor.handoffs, ['takeover']);
            const page = await t.get(`/web/t/${id}`, { cookie: signedIn });
            assert.match(page.text, /data-sf-desk-giveback-form>/);
            assert.match(page.text, /data-sf-desk-takeover-form hidden/);
            const back = await t.get(`/api/v1/web/tasks/${id}/giveback`, { cookie: signedIn, method: 'POST', headers: { origin: ORIGIN } });
            assert.strictEqual(back.status, 303);
            assert.strictEqual(back.headers.get('location'), `/web/t/${id}`);
            assert.deepStrictEqual(t.upstreams.state.actor.handoffs, ['takeover', 'giveback']);
            assert.strictEqual((await t.get(`/api/v1/web/tasks/${id}/takeover`, { cookie: signedIn, method: 'POST' })).status, 403, 'no Origin is not this site');
        });
    } finally {
        await t.close();
        done();
    }
})().catch((err) => { console.error(err); process.exit(1); });
