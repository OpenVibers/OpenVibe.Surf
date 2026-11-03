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

    await check('llms-full.txt (SEO-33): the site in full, from the same descriptor as llms.txt', async () => {
        const r = await t.get('/llms-full.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type') || '', /^text\/plain/);
        assert.ok(r.text.startsWith('# OpenVibe.Surf'), r.text.slice(0, 60));
        assert.ok(r.text.length > 500, `${r.text.length} characters`);
        assert.match(r.text, /## About\n\n### /);
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
        // AGT-5: each of its own pages at the Markdown twin, an Optional section last.
        assert.match(r.text, /\[OpenVibe\.Surf\]\(https:\/\/openvibe\.surf\/index\.md\)/, 'the home is /index.md');
        assert.match(r.text, /\[Ride\]\(https:\/\/openvibe\.surf\/ride\.md\)/, 'a page is its twin');
        assert.match(r.text, /\[For developers\]\(https:\/\/openvibe\.surf\/developers\.md\)/);
        assert.match(r.text, /\[The Watch feed \(JSON\)\]\(https:\/\/openvibe\.surf\/api\/v1\/watch\/feed\?topic=all\)/, 'an API URL keeps its URL');
        assert.match(r.text, /\n## Optional\n/);
        assert.match(r.text, /\n## Optional\n\n[\s\S]*\[Sitemap\]\(https:\/\/openvibe\.surf\/sitemap\.xml\)/);
        assert.strictEqual(r.text.lastIndexOf('\n## '), r.text.indexOf('\n## Optional'), 'Optional is the last section');
        const own = [...r.text.matchAll(/\]\((https:\/\/openvibe\.surf[^)\s]*)\)( \(HTML\))?/g)];
        assert.ok(own.length > 8, String(own.length));
        for (const [, url, html] of own) {
            const p = new URL(url).pathname;
            assert.ok(p.endsWith('.md') || /\.[a-z0-9]+$/.test(p) || p.startsWith('/api/') || html, `${url} is a twin, a file or marked (HTML)`);
        }
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
