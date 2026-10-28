'use strict';
/** The crawl artifacts: robots.txt, sitemap.xml (the public pages and the Ride maps) and llms.txt. */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();

    await check('robots.txt names the sitemap and keeps crawlers out of the API, sign-in and the task form', async () => {
        const r = await t.get('/robots.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /text\/plain/);
        assert.match(r.text, /Sitemap: https:\/\/openvibe\.surf\/sitemap\.xml/);
        assert.match(r.text, /Disallow: \/api\//);
        assert.match(r.text, /Disallow: \/auth\//);
        assert.match(r.text, /Disallow: \/web\/go/);
    });

    await check('sitemap.xml lists the five public pages and the maps Games lists', async () => {
        const r = await t.get('/sitemap.xml');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /application\/xml/);
        for (const path of ['/', '/ride', '/watch', '/web', '/developers']) {
            assert.ok(r.text.includes(`<loc>https://openvibe.surf${path}</loc>`), `sitemap has ${path}`);
        }
        assert.match(r.text, /<loc>https:\/\/openvibe\.surf\/ride\/surf_lagoon<\/loc>/);
        assert.match(r.text, /<lastmod>2026-/);
    });

    await check('llms.txt describes the room, its three surfs and the machine-readable routes', async () => {
        const r = await t.get('/llms.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /# OpenVibe\.Surf/);
        assert.match(r.text, /Ride maps, surf the web, surf what's on/i);
        assert.match(r.text, /https:\/\/openvibe\.surf\/api\/v1\/watch\/feed\?topic=all/);
        assert.match(r.text, /https:\/\/openvibe\.surf\/api\/v1\/ride\/maps/);
        assert.match(r.text, /https:\/\/openvibe\.live/);
        assert.match(r.text, /https:\/\/openvibe\.games/);
        assert.match(r.text, /https:\/\/openvibe\.actor/);
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
