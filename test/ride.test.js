'use strict';
/**
 * Ride: the Games proxy (the maps list and one map), its 60 s cache, Games 404 → an empty list with
 * games: 'not_ready', a Games failure → 502, and the map's embed URL.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();

    await check('GET /api/v1/ride/maps proxies Games and adds each map’s embed URL', async () => {
        t.ctx.ride.clear();
        t.upstreams.resetCounts();
        const r = await t.get('/api/v1/ride/maps');
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
        const b = r.json();
        assert.strictEqual(b.games, 'ready');
        assert.strictEqual(b.maps.length, 3);
        assert.strictEqual(b.maps[0].id, 'surf_lagoon');
        assert.strictEqual(b.maps[0].name, 'Surf Lagoon');
        assert.strictEqual(b.maps[0].tier, 1);
        assert.strictEqual(b.maps[0].stages, 3);
        assert.strictEqual(b.maps[0].embed_url, 'https://openvibe.games/play/surf?map=surf_lagoon&embed=1');
        assert.strictEqual(t.upstreams.state.counts.maps, 1);
    });

    await check('the list is cached for 60 s', async () => {
        t.upstreams.resetCounts();
        await t.get('/api/v1/ride/maps');
        assert.strictEqual(t.upstreams.state.counts.maps, 0, 'the second read is the cached list');
        t.clock.advance(60_001);
        await t.get('/api/v1/ride/maps');
        assert.strictEqual(t.upstreams.state.counts.maps, 1, 'after 60 s it asks Games again');
    });

    await check('GET /api/v1/ride/maps/:id returns the map, its records and the embed', async () => {
        t.ctx.ride.clear();
        t.upstreams.resetCounts();
        const r = await t.get('/api/v1/ride/maps/surf_lagoon');
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
        const b = r.json();
        assert.strictEqual(b.games, 'ready');
        assert.strictEqual(b.map.id, 'surf_lagoon');
        assert.strictEqual(b.map.records, 5);
        assert.strictEqual(b.map.wrMs, 61234);
        assert.strictEqual(b.map.embed_url, 'https://openvibe.games/play/surf?map=surf_lagoon&embed=1');
        assert.deepStrictEqual(b.top[0], { rank: 1, name: 'ada', timeMs: 61234, runId: null });
        const again = await t.get('/api/v1/ride/maps/surf_lagoon');
        assert.strictEqual(again.status, 200);
        assert.strictEqual(t.upstreams.state.counts.map, 1, 'the map is cached too');
    });

    await check('Games 404 means not_ready: an empty list and a map shell that still embeds', async () => {
        t.ctx.ride.clear();
        t.upstreams.state.gamesNotFound = true;
        const list = await t.get('/api/v1/ride/maps');
        assert.strictEqual(list.status, 200, list.text);
        assert.deepStrictEqual(list.json(), { maps: [], games: 'not_ready' });
        assert.strictEqual(list.headers.get('cache-control'), 'public, max-age=60');
        const one = await t.get('/api/v1/ride/maps/surf_lagoon');
        assert.strictEqual(one.status, 200, one.text);
        const b = one.json();
        assert.strictEqual(b.games, 'not_ready');
        assert.strictEqual(b.map.id, 'surf_lagoon');
        assert.strictEqual(b.map.embed_url, 'https://openvibe.games/play/surf?map=surf_lagoon&embed=1');
        assert.deepStrictEqual(b.top, []);
        t.upstreams.state.gamesNotFound = false;
    });

    await check('a Games failure is a 502 problem, and a failure is never cached', async () => {
        t.ctx.ride.clear();
        t.upstreams.state.gamesStatus = 503;
        const r = await t.get('/api/v1/ride/maps');
        assert.strictEqual(r.status, 502, r.text);
        assert.match(r.headers.get('content-type'), /application\/problem\+json/);
        assert.strictEqual(r.json().code, 'games.unavailable');
        t.upstreams.state.gamesStatus = null;
        const ok = await t.get('/api/v1/ride/maps');
        assert.strictEqual(ok.status, 200, 'the next request asks again');
        assert.strictEqual(ok.json().games, 'ready');
    });

    await check('a blank map id is a 400', async () => {
        const r = await t.get('/api/v1/ride/maps/%20');
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.json().code, 'ride.invalid_map');
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
