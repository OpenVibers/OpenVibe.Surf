'use strict';
/**
 * Watch together: open/join/leave, the host-only and same-site command rules, SSE delivering a command, the
 * empty-party TTL and the hard caps (200 parties, 50 members; boot lowers them for this file).
 */
const assert = require('assert');
const http = require('http');
const { boot, check, done } = require('./helpers/boot');

const ORIGIN = 'https://openvibe.surf';
const own = { origin: ORIGIN, 'sec-fetch-site': 'same-origin' };

/** A tiny SSE client: events are parsed as they arrive, waitFor() blocks until one named event shows up. */
function openEvents(t, path, cookie) {
    const events = [];
    let buffer = '';
    let req = null;
    const ready = new Promise((resolve, reject) => {
        req = http.get(`${t.base}${path}`, { headers: { cookie, accept: 'text/event-stream' } }, (res) => {
            res.setEncoding('utf8');
            if (res.statusCode !== 200) {
                let text = '';
                res.on('data', (c) => { text += c; });
                res.on('end', () => reject(new Error(`SSE ${res.statusCode}: ${text}`)));
                return;
            }
            res.on('data', (chunk) => {
                buffer += chunk;
                let at;
                while ((at = buffer.indexOf('\n\n')) >= 0) {
                    const block = buffer.slice(0, at);
                    buffer = buffer.slice(at + 2);
                    let event = 'message';
                    let data = '';
                    for (const line of block.split('\n')) {
                        if (line.startsWith('event:')) event = line.slice(6).trim();
                        else if (line.startsWith('data:')) data += line.slice(5).trim();
                    }
                    if (!data) continue;
                    let parsed = data;
                    try { parsed = JSON.parse(data); } catch { /* keep the text */ }
                    events.push({ event, data: parsed });
                }
            });
            resolve();
        });
        req.on('error', reject);
    });
    return {
        ready,
        events,
        async waitFor(event, timeoutMs = 3000) {
            const started = Date.now();
            for (;;) {
                const hit = events.find((e) => e.event === event);
                if (hit) return hit;
                if (Date.now() - started > timeoutMs) {
                    throw new Error(`no ${event} event; got ${events.map((e) => e.event).join(', ') || 'nothing'}`);
                }
                await new Promise((r) => setTimeout(r, 20));
            }
        },
        close() { if (req) req.destroy(); },
    };
}

(async () => {
    const t = await boot();
    const host = t.network.addUser('kim');
    const member = t.network.addUser('ada');
    const other = t.network.addUser('noa');
    const hostCookie = t.signIn(host);
    const memberCookie = t.signIn(member);
    let partyPath = null;

    await check('POST /watch/party opens an unguessable party and redirects to it', async () => {
        const r = await t.get('/watch/party', { cookie: hostCookie, method: 'POST', headers: own });
        assert.strictEqual(r.status, 303, r.text);
        const location = r.headers.get('location') || '';
        assert.match(location, /^\/watch\/p\/[A-Za-z0-9_-]{20,64}$/, 'an unguessable id in the path');
        partyPath = location;
        const page = await t.get(partyPath, { cookie: hostCookie });
        assert.strictEqual(page.status, 200, page.text);
        assert.match(page.text, /id="sf-party"/);
        assert.match(page.text, /data-sf-party-is-host="1"/);
        assert.match(page.text, /data-sf-party-members>1</);
        assert.match(page.text, /host <b data-sf-party-host-name>kim<\/b>/);
        assert.match(page.text, /id="sf-tv"/, 'the same TV markup');
        assert.match(page.text, /data-sf-party-copy/, 'Copy link');
        assert.match(page.text, /data-sf-party-leave/, 'Leave');
        assert.match(page.text, /data-sf-party-chat-form/, 'the host can paste a chat link');
        assert.strictEqual(page.headers.get('cache-control'), 'private, no-store');
        assert.match(page.headers.get('vary'), /Cookie/i);
    });

    await check('a signed-out visitor is sent to sign in before joining', async () => {
        const r = await t.get(partyPath);
        assert.strictEqual(r.status, 303);
        assert.strictEqual(r.headers.get('location'), `/auth/login?next=${encodeURIComponent(partyPath)}`);
    });

    await check('a signed-in person joins once; the party bar counts them and names the host', async () => {
        const first = await t.get(partyPath, { cookie: memberCookie });
        assert.strictEqual(first.status, 200, first.text);
        assert.match(first.text, /data-sf-party-is-host="0"/);
        assert.match(first.text, /data-sf-party-members>2</);
        assert.match(first.text, /host <b data-sf-party-host-name>kim<\/b>/);
        assert.ok(!first.text.includes('data-sf-party-chat-form'), 'only the host sets the chat link');
        const again = await t.get(partyPath, { cookie: memberCookie });
        assert.match(again.text, /data-sf-party-members>2</, 'a second visit is not a second member');
    });

    await check('SSE delivers the host command; a member and another site cannot command', async () => {
        const stream = openEvents(t, `${partyPath}/events`, memberCookie);
        try {
            await stream.ready;
            const initial = await stream.waitFor('state');
            assert.strictEqual(initial.data.members, 2);
            assert.strictEqual(initial.data.host, 'kim');
            assert.strictEqual(initial.data.id, partyPath.split('/').pop());
            assert.strictEqual(initial.data.is_host, false);

            const command = { channel_key: 'clip:101', position_s: 12.5, playing: false, at: Date.now() };
            const byMember = await t.get(`${partyPath}/command`, { cookie: memberCookie, method: 'POST', json: command, headers: own });
            assert.strictEqual(byMember.status, 403, byMember.text);
            assert.strictEqual(byMember.json().code, 'party.not_host');

            const byOtherSite = await t.get(`${partyPath}/command`, {
                cookie: hostCookie, method: 'POST', json: command, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
            });
            assert.strictEqual(byOtherSite.status, 403, 'a cross-site command is refused');
            assert.strictEqual(byOtherSite.json().code, 'party.cross_site');

            const sent = await t.get(`${partyPath}/command`, { cookie: hostCookie, method: 'POST', json: command, headers: own });
            assert.strictEqual(sent.status, 200, sent.text);
            assert.deepStrictEqual(sent.json().command, command);
            const event = await stream.waitFor('command');
            assert.strictEqual(event.data.channel_key, 'clip:101');
            assert.strictEqual(event.data.position_s, 12.5);
            assert.strictEqual(event.data.playing, false);
            assert.strictEqual(event.data.at, command.at, 'the host timestamp is relayed');
        } finally {
            stream.close();
        }
    });

    await check('the host can link a validated OpenVibe.Chat room, and nothing else', async () => {
        const bad = await t.get(`${partyPath}/chat`, {
            cookie: hostCookie, method: 'POST', json: { chat_url: 'https://evil.example/room' }, headers: own,
        });
        assert.strictEqual(bad.status, 400);
        assert.strictEqual(bad.json().code, 'party.invalid_chat');
        const good = await t.get(`${partyPath}/chat`, {
            cookie: hostCookie, method: 'POST', json: { chat_url: 'https://openvibe.chat/room/surf-1' }, headers: own,
        });
        assert.strictEqual(good.status, 200, good.text);
        assert.strictEqual(good.json().chat_url, 'https://openvibe.chat/room/surf-1');
        const page = await t.get(partyPath, { cookie: memberCookie });
        assert.match(page.text, /href="https:\/\/openvibe\.chat\/room\/surf-1"/);
        assert.match(page.text, /Chat in OpenVibe\.Chat/);
        assert.match(page.text, /class="sf-ch is-on"[^>]*data-sf-key="clip:101"/, 'the page renders the host\'s last channel');
    });

    await check('anyone can leave, the member count follows, and the last one out starts the TTL', async () => {
        const id = partyPath.split('/').pop();
        const left = await t.get(`${partyPath}/leave`, { cookie: memberCookie, method: 'POST', headers: own });
        assert.strictEqual(left.status, 303);
        assert.strictEqual(left.headers.get('location'), '/watch');
        assert.strictEqual(t.ctx.parties.get(id).members.size, 1);
        const hostPage = await t.get(partyPath, { cookie: hostCookie });
        assert.match(hostPage.text, /data-sf-party-members>1</);
        const last = await t.get(`${partyPath}/leave`, { cookie: hostCookie, method: 'POST', headers: own });
        assert.strictEqual(last.status, 303);
        const empty = t.ctx.parties.get(id);
        assert.ok(empty);
        assert.strictEqual(empty.members.size, 0, 'the party stays for its 30-minute window');
        t.clock.advance(30 * 60 * 1000 - 1);
        assert.ok(t.ctx.parties.get(id), 'still there a moment before 30 minutes');
        t.clock.advance(2);
        assert.strictEqual(t.ctx.parties.get(id), null, 'an empty party ends 30 minutes after the last member leaves');
        const gone = await t.get(partyPath, { cookie: memberCookie });
        assert.strictEqual(gone.status, 404);
        assert.match(gone.text, /Party over/);
    });

    await check('if the host leaves, the earliest remaining member becomes host', async () => {
        const made = await t.get('/watch/party', {
            cookie: hostCookie, method: 'POST', json: {},
            headers: { ...own, accept: 'application/json' },
        });
        const path = made.json().url;
        assert.strictEqual((await t.get(path, { cookie: memberCookie })).status, 200);
        const leaving = await t.get(`${path}/leave`, { cookie: hostCookie, method: 'POST', json: {}, headers: own });
        assert.strictEqual(leaving.status, 200, leaving.text);
        assert.strictEqual(leaving.json().hostChanged, true);
        const promoted = await t.get(`${path}/command`, {
            cookie: memberCookie, method: 'POST', json: { channel_key: 'live:ada', position_s: 4, playing: true, at: Date.now() }, headers: own,
        });
        assert.strictEqual(promoted.status, 200, promoted.text);
        assert.strictEqual(promoted.json().command.channel_key, 'live:ada');
        await t.get(`${path}/leave`, { cookie: memberCookie, method: 'POST', json: {}, headers: own });
    });

    await check('the JSON form creates a party without a redirect and names its stream', async () => {
        const r = await t.get('/watch/party', {
            cookie: other ? t.signIn(other) : hostCookie, method: 'POST', json: {},
            headers: { ...own, accept: 'application/json' },
        });
        assert.strictEqual(r.status, 201, r.text);
        const b = r.json();
        assert.match(b.id, /^[A-Za-z0-9_-]{20,64}$/);
        assert.strictEqual(b.url, `/watch/p/${b.id}`);
        assert.strictEqual(b.events_url, `/watch/p/${b.id}/events`);
        assert.strictEqual(b.party.members, 1);
        assert.ok(b.party.channel_key, 'the party starts on the first channel in the guide');
    });

    await t.close();

    // A second process with low caps: the limits are hard caps (200/50), testable by lowering them.
    const small = await boot({ env: { SURF_PARTY_MAX: '2', SURF_PARTY_MEMBER_MAX: '2' } });
    const a = small.network.addUser('a');
    const b = small.network.addUser('b');
    const c = small.network.addUser('c');
    const create = async (user) => small.get('/watch/party', {
        cookie: small.signIn(user), method: 'POST', json: {},
        headers: { ...own, accept: 'application/json' },
    });

    await check('at most 200 parties and 50 members each: the lowered caps refuse the next one', async () => {
        const one = await create(a);
        const two = await create(b);
        assert.strictEqual(one.status, 201, one.text);
        assert.strictEqual(two.status, 201, two.text);
        const tooMany = await create(c);
        assert.strictEqual(tooMany.status, 429, tooMany.text);
        assert.strictEqual(tooMany.json().code, 'party.limit');

        const p1 = one.json().url;
        const joined = await small.get(p1, { cookie: small.signIn(b) });
        assert.strictEqual(joined.status, 200, joined.text);
        assert.match(joined.text, /data-sf-party-members>2</);
        const full = await small.get(p1, { cookie: small.signIn(c) });
        assert.strictEqual(full.status, 429, 'the third member is refused');
        assert.match(full.text, /party is full/);
    });

    await small.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
