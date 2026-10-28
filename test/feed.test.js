'use strict';
/**
 * Watch: the merge and its order (live streams by viewers, moments and clips interleaved by freshness, never two
 * cards from one channel in a row), the one item shape, a failing source left out and named, and the 30 s cache.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

const kinds = (feed) => feed.items.map((i) => i.kind);
const channels = (feed) => feed.items.map((i) => i.channel.username);

(async () => {
    const t = await boot();

    await check('GET /api/v1/watch/feed merges the three sources into the one shape', async () => {
        t.ctx.feed.clear();
        const r = await t.get('/api/v1/watch/feed?topic=all');
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=30');
        const b = r.json();
        assert.strictEqual(b.topic, 'all');
        assert.deepStrictEqual(b.sources, { live: 'ok', clips: 'ok', moments: 'ok' });
        assert.strictEqual(b.partial, false);
        assert.deepStrictEqual(kinds(b), ['live', 'live', 'live', 'moment', 'clip', 'clip'], 'lives first, then moments/clips interleaved by freshness');
        assert.deepStrictEqual(channels(b).slice(0, 3), ['bo', 'ada', 'cy'], 'live streams by viewers');
        for (const item of b.items) {
            assert.deepStrictEqual(Object.keys(item).sort(), ['channel', 'duration_seconds', 'key', 'kind', 'play', 'thumbnail', 'title', 'viewers', 'why'].sort());
            assert.deepStrictEqual(Object.keys(item.channel).sort(), ['avatar_url', 'display_name', 'username']);
            assert.deepStrictEqual(Object.keys(item.play).sort(), ['page', 'src', 'type']);
            assert.match(item.key, /^(live|clip|moment):/);
            assert.match(item.play.page, /^https:\/\/openvibe\.(live|video)\//, 'a page on Live or on openvibe.video');
        }
        const live = b.items[0];
        assert.strictEqual(live.key, 'live:bo');
        assert.strictEqual(live.play.type, 'live');
        assert.strictEqual(live.play.src, null);
        assert.strictEqual(live.play.page, 'https://openvibe.live/@bo');
        assert.strictEqual(live.viewers, 38);
        assert.strictEqual(live.why, 'Live now · 38 watching');
        const moment = b.items.find((i) => i.kind === 'moment');
        assert.strictEqual(moment.play.type, 'hls');
        assert.strictEqual(moment.play.src, 'https://openvibe.media/c/201/master.m3u8');
        assert.strictEqual(moment.play.page, 'https://openvibe.video/c/201', 'clips and moments open on openvibe.video');
        assert.strictEqual(moment.why, 'Top AI moment this week');
        const clip = b.items.find((i) => i.kind === 'clip');
        assert.strictEqual(clip.why, 'New clip');
        assert.strictEqual(clip.duration_seconds, 31);
    });

    await check('moments and clips alternate by freshness, and no channel runs twice', async () => {
        t.ctx.feed.clear();
        t.upstreams.state.streams = [
            { username: 'bo', display_name: 'Bo', title: 'Bo live', viewer_count: 38, total_viewer_count: 38 },
            { username: 'ada', display_name: 'Ada', title: 'Ada live', viewer_count: 12, total_viewer_count: 12 },
        ];
        t.upstreams.state.moments = [
            { id: 1, href: '/clip/1', title: 'Moment one', created_at: '2026-10-28T10:00:00.000Z', channel: { username: 'mira' }, preview_url: 'https://openvibe.media/c/1/master.m3u8', thumbnail_url: 'https://openvibe.media/c/1.jpg' },
            { id: 2, href: '/clip/2', title: 'Moment two', created_at: '2026-10-28T08:00:00.000Z', channel: { username: 'noa' }, preview_url: 'https://openvibe.media/c/2/master.m3u8', thumbnail_url: 'https://openvibe.media/c/2.jpg' },
        ];
        t.upstreams.state.clips = [
            { id: 11, href: '/clip/11', title: 'Clip one', created_at: '2026-10-28T09:00:00.000Z', channel: { username: 'ada' }, preview_url: 'https://openvibe.media/c/11/master.m3u8' },
            { id: 12, href: '/clip/12', title: 'Clip two', created_at: '2026-10-28T07:00:00.000Z', channel: { username: 'bo' }, preview_url: 'https://openvibe.media/c/12/master.m3u8' },
        ];
        const b = (await t.get('/api/v1/watch/feed?topic=all')).json();
        assert.deepStrictEqual(kinds(b), ['live', 'live', 'moment', 'clip', 'moment', 'clip']);
        assert.deepStrictEqual(channels(b), ['bo', 'ada', 'mira', 'ada', 'noa', 'bo']);
        const names = channels(b);
        for (let i = 1; i < names.length; i++) assert.notStrictEqual(names[i], names[i - 1], `no channel twice in a row at ${i}`);
    });

    await check('a card from the same channel as the previous one is moved down', async () => {
        t.ctx.feed.clear();
        t.upstreams.state.streams = [{ username: 'cy', display_name: 'Cy', title: 'Cy live', viewer_count: 5, total_viewer_count: 5 }];
        t.upstreams.state.moments = [{ id: 21, href: '/clip/21', title: 'Cy moment', created_at: '2026-10-28T10:00:00.000Z', channel: { username: 'cy' }, preview_url: 'https://openvibe.media/c/21/master.m3u8' }];
        t.upstreams.state.clips = [
            { id: 31, href: '/clip/31', title: 'Ada clip', created_at: '2026-10-28T09:00:00.000Z', channel: { username: 'ada' }, preview_url: 'https://openvibe.media/c/31/master.m3u8' },
            { id: 32, href: '/clip/32', title: 'Bo clip', created_at: '2026-10-28T08:00:00.000Z', channel: { username: 'bo' }, preview_url: 'https://openvibe.media/c/32/master.m3u8' },
        ];
        const b = (await t.get('/api/v1/watch/feed?topic=all')).json();
        assert.strictEqual(b.items.length, 4);
        assert.strictEqual(b.items[0].channel.username, 'cy', 'the live card stays first');
        assert.notStrictEqual(b.items[1].channel.username, 'cy', 'the next card is another channel');
        const names = channels(b);
        for (let i = 1; i < names.length; i++) assert.notStrictEqual(names[i], names[i - 1], `no channel twice in a row at ${i}`);
    });

    await check('a failing source is left out and named in sources', async () => {
        t.ctx.feed.clear();
        t.upstreams.state.fail.moments = 500;
        const r = await t.get('/api/v1/watch/feed?topic=all');
        t.upstreams.state.fail.moments = null;
        assert.strictEqual(r.status, 200, 'the feed still answers');
        const b = r.json();
        assert.ok(!b.items.some((i) => i.kind === 'moment'), 'no moment cards');
        assert.ok(b.items.some((i) => i.kind === 'clip'), 'clips still there');
        assert.strictEqual(b.sources.moments, 'error');
        assert.strictEqual(b.sources.clips, 'ok');
        assert.strictEqual(b.partial, true);
        const recovered = await t.get('/api/v1/watch/feed?topic=all');
        assert.strictEqual(recovered.json().sources.moments, 'ok', 'a partial page is not cached: the next request retries');
        assert.ok(recovered.json().items.some((i) => i.kind === 'moment'));
    });

    await check('a slow source times out after its 2 s budget (500 ms in this test) and is named', async () => {
        t.ctx.feed.clear();
        t.upstreams.state.delay.streams = 900;   // boot sets the source budget to 500 ms
        const started = Date.now();
        const r = await t.get('/api/v1/watch/feed?topic=live');
        t.upstreams.state.delay.streams = 0;
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.json().sources.live, 'timeout');
        assert.ok(Date.now() - started < 1500, 'it did not wait for the slow source');
        assert.deepStrictEqual(r.json().items, []);
    });

    await check('the merged feed is cached for 30 s', async () => {
        t.ctx.feed.clear();
        t.upstreams.resetCounts();
        await t.get('/api/v1/watch/feed?topic=all');
        const once = { ...t.upstreams.state.counts };
        assert.strictEqual(once.streams, 1);
        assert.strictEqual(once.clips, 1);
        assert.strictEqual(once.moments, 1);
        await t.get('/api/v1/watch/feed?topic=all');
        assert.deepStrictEqual({ ...t.upstreams.state.counts }, once, 'the second read is the cached page');
        t.clock.advance(30_001);
        await t.get('/api/v1/watch/feed?topic=all');
        assert.strictEqual(t.upstreams.state.counts.streams, once.streams + 1, 'after 30 s it asks again');
    });

    await check('topic filters only fetch what they need, and a cursor pages the Live feeds', async () => {
        t.ctx.feed.clear();
        t.upstreams.resetCounts();
        const live = await t.get('/api/v1/watch/feed?topic=live');
        assert.deepStrictEqual(kinds(live.json()), ['live']);
        assert.strictEqual(t.upstreams.state.counts.clips, 0);
        assert.strictEqual(t.upstreams.state.counts.moments, 0);

        t.ctx.feed.clear();
        t.upstreams.state.clipsNext = 'clip-page-2';
        t.upstreams.state.momentsNext = 'moment-page-2';
        const first = (await t.get('/api/v1/watch/feed?topic=all')).json();
        assert.ok(first.next, 'a next cursor when either source has more');
        t.upstreams.resetCounts();
        const second = await t.get(`/api/v1/watch/feed?topic=all&cursor=${encodeURIComponent(first.next)}`);
        assert.strictEqual(second.status, 200, second.text);
        assert.strictEqual(t.upstreams.state.counts.streams, 0, 'live streams are not repeated on page two');
        const clips = t.upstreams.lastFor('/api/content/feed');
        const moments = t.upstreams.lastFor('/api/content/moments');
        assert.strictEqual(clips.query.cursor, 'clip-page-2');
        assert.strictEqual(moments.query.cursor, 'moment-page-2');
    });

    await check('a bad topic or cursor is a 400 problem', async () => {
        const badTopic = await t.get('/api/v1/watch/feed?topic=nope');
        assert.strictEqual(badTopic.status, 400);
        assert.strictEqual(badTopic.json().code, 'watch.invalid_topic');
        const badCursor = await t.get('/api/v1/watch/feed?topic=all&cursor=not-a-cursor');
        assert.strictEqual(badCursor.status, 400);
        assert.strictEqual(badCursor.json().code, 'watch.invalid_cursor');
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
