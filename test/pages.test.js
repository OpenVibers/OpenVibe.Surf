'use strict';
/**
 * The pages and the plumbing: /, /ride, /ride/:map, /watch, /web, /developers, the 404; public vs signed-in cache
 * policy; the CSP the embeds need; health and truthful readiness; the release manifest and content-hashed assets.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { assetVersion } = require('../server/assets');

(async () => {
    const t = await boot();
    const user = t.network.addUser('kim');

    await check('the home page has the three tiles and is publicly cacheable', async () => {
        const r = await t.get('/');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /id="sf-tile-ride"/);
        assert.match(r.text, /id="sf-tile-watch"/);
        assert.match(r.text, /id="sf-tile-web"/);
        assert.match(r.text, /href="\/ride"/);
        assert.match(r.text, /href="\/watch"/);
        assert.match(r.text, /href="\/web"/);
        assert.match(r.text, /<main id="main"/);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
        assert.match(r.headers.get('vary'), /Cookie/i);
    });

    await check('/ride lists the maps and embeds the first', async () => {
        const r = await t.get('/ride');
        assert.strictEqual(r.status, 200, r.text);
        assert.match(r.text, /id="sf-maps"/);
        assert.match(r.text, /href="\/ride\/surf_lagoon"/);
        assert.match(r.text, /Surf Lagoon/);
        assert.match(r.text, /id="sf-embed"/);
        assert.match(r.text, /src="https:\/\/openvibe\.games\/surf\/embed\?map=surf_lagoon&amp;embed=1"/);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
    });

    await check('/ride/:map shows the name, tier, stages, records and the embed', async () => {
        const r = await t.get('/ride/surf_lagoon');
        assert.strictEqual(r.status, 200, r.text);
        assert.match(r.text, /Surf Lagoon/);
        assert.match(r.text, /Beginner/);
        assert.match(r.text, /3 stages/);
        assert.match(r.text, /5 runs/);
        assert.match(r.text, /1:01\.234/);
        assert.match(r.text, /id="sf-top"/);
        assert.match(r.text, /ada/);
        assert.match(r.text, /src="https:\/\/openvibe\.games\/surf\/embed\?map=surf_lagoon&amp;embed=1"/);
    });

    await check('/ride/:map still embeds when Games has not added its routes yet', async () => {
        t.ctx.ride.clear();
        t.upstreams.state.gamesNotFound = true;
        const r = await t.get('/ride/surf_lagoon');
        t.upstreams.state.gamesNotFound = false;
        t.ctx.ride.clear();
        assert.strictEqual(r.status, 200, r.text);
        assert.match(r.text, /id="sf-ride-not-ready"/);
        assert.match(r.text, /src="https:\/\/openvibe\.games\/surf\/embed\?map=surf_lagoon&amp;embed=1"/);
    });

    await check('/watch is the feed as a list with thumbnails, play links and HLS hooks', async () => {
        t.ctx.feed.clear();
        const r = await t.get('/watch');
        assert.strictEqual(r.status, 200, r.text);
        assert.match(r.text, /id="sf-watch-feed"/);
        assert.match(r.text, /class="sf-ch is-on"[^>]*data-sf-kind="live"/, 'the guide, live first and on');
        assert.match(r.text, /data-sf-tv/, 'the TV');
        assert.match(r.text, /https:\/\/openvibe\.media\/live\/bo\.jpg/);
        assert.match(r.text, /href="https:\/\/openvibe\.live\/@bo"/);
        assert.match(r.text, /data-sf-play-type="hls"/);
        assert.match(r.text, /data-sf-src="https:\/\/openvibe\.media\/c\/201\/master\.m3u8"/);
        assert.match(r.text, /Live now · 38 watching/);
        assert.match(r.text, /Top AI moment this week/);
        assert.match(r.text, /New clip/);
        assert.match(r.text, /id="sf-topics"/);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
    });

    await check('/watch?topic=live only lists live streams', async () => {
        t.ctx.feed.clear();
        const r = await t.get('/watch?topic=live');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /data-sf-kind="live"/);
        assert.ok(!r.text.includes('data-sf-kind="clip"'), 'no clips on the live topic');
        assert.ok(!r.text.includes('data-sf-kind="moment"'), 'no moments on the live topic');
    });

    await check('/web is the Surf with Vibe form and what it does', async () => {
        const r = await t.get('/web');
        assert.strictEqual(r.status, 200, r.text);
        assert.match(r.text, /id="sf-web-form"/);
        assert.match(r.text, /action="\/web\/go"/);
        assert.match(r.text, /id="sf-web-query"/);
        assert.match(r.text, /minlength="3"/);
        assert.match(r.text, /maxlength="500"/);
        assert.match(r.text, /method="post"/, 'the plain form posts: the query is never in a URL');
        assert.match(r.text, /asked to sign in/);
        assert.match(r.text, /Search Fabric/);
        assert.match(r.text, /private desk/);
        assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
        const me = await t.get('/web', { as: user });
        assert.strictEqual(me.status, 200);
        assert.match(me.text, /Runs as <b>kim<\/b>/);
        assert.strictEqual(me.headers.get('cache-control'), 'private, no-store', 'a signed-in page is never cached');
    });

    await check('/developers and the 404', async () => {
        const dev = await t.get('/developers');
        assert.strictEqual(dev.status, 200);
        assert.match(dev.text, /GET \/api\/v1\/watch\/feed/);
        assert.match(dev.text, /POST \/api\/v1\/web\/tasks/);
        const gone = await t.get('/not-a-page');
        assert.strictEqual(gone.status, 404);
        assert.match(gone.text, /id="sf-not-found"/);
        assert.match(gone.text, /Wiped out/);
    });

    await check('the CSP allows the Games embed, a Live player and the media edge', async () => {
        const r = await t.get('/');
        const csp = r.headers.get('content-security-policy') || '';
        assert.match(csp, /frame-src 'self' https:\/\/openvibe\.games https:\/\/openvibe\.live/);
        assert.match(csp, /media-src 'self' https:\/\/openvibe\.media https:\/\/edge\.openvibe\.media https:\/\/\*\.r2\.cloudflarestorage\.com https:\/\/\*\.backblazeb2\.com blob:/);
        assert.match(csp, /connect-src [^;]*https:\/\/openvibe\.media/, 'hls.js fetches Media\'s playlists and segments');
        assert.match(csp, /connect-src 'self' https:\/\/openvibe\.network https:\/\/cloudflareinsights\.com https:\/\/openvibe\.events/);
    });

    await check('health and readiness are honest; a Network outage is degraded, not down', async () => {
        const health = await t.get('/api/health');
        assert.strictEqual(health.status, 200);
        assert.strictEqual(health.json().status, 'ok');
        assert.strictEqual(health.json().service, 'openvibe-surf');
        assert.strictEqual(health.json().version, '0.1.0');
        const ready = await t.get('/api/ready');
        assert.strictEqual(ready.status, 200, ready.text);
        assert.strictEqual(ready.json().ready, true);
        assert.strictEqual(ready.json().checks.network.status, 'ok');
        t.network.setDown(true);
        const degraded = await t.get('/api/ready');
        t.network.setDown(false);
        assert.strictEqual(degraded.status, 200, 'the process still serves');
        assert.strictEqual(degraded.json().ready, true);
        assert.strictEqual(degraded.json().status, 'degraded');
        assert.ok(degraded.json().degraded.includes('network'));
    });

    await check('the release manifest and content-hashed static assets', async () => {
        const rel = await t.get('/release.json');
        assert.strictEqual(rel.status, 200);
        assert.strictEqual(rel.json().service, 'surf');
        assert.match(rel.headers.get('content-type'), /application\/json/);
        const css = await t.get('/css/surf.css');
        assert.strictEqual(css.status, 200);
        assert.match(css.text, /OpenVibe\.Surf: the room's own pieces/);
        const hashed = await t.get(`/css/surf.css?v=${assetVersion('css/surf.css')}`);
        assert.strictEqual(hashed.status, 200);
        assert.strictEqual(hashed.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        const js = await t.get(`/js/surf.js?v=${assetVersion('js/surf.js')}`);
        assert.strictEqual(js.status, 200);
        assert.match(js.headers.get('content-type'), /javascript/);
        const shared = await t.get('/shared/room.css');
        assert.strictEqual(shared.status, 200);
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
