'use strict';
/**
 * The home on a phone (the owner, 2026-10-31: never hide content to shorten a page): the three scenes are all shown,
 * a row of chips links to each, and the questions are a counted fold. The chips used to pick one scene and hide the
 * others.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('every scene is shown; the chips are links that jump to one (the owner, 2026-10-31)', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200, r.text);
            const page = r.text;
            assert.ok(page.includes('<div class="pick" id="pick-scenes">'), 'the scenes block is on the home');
            const block = page.slice(page.indexOf('<div class="pick" id="pick-scenes">'));
            assert.ok(!/type="radio"/.test(block), 'no radio chips');
            const chips = [...block.matchAll(/<a class="pick-chip" href="#(scene-\d+)">([^<]+)<\/a>/g)];
            assert.deepStrictEqual(chips.map((m) => m[1]), ['scene-0', 'scene-1', 'scene-2'], 'a link per scene');
            const panes = [...block.matchAll(/<div class="pick-pane" id="scene-(\d+)">/g)].map((m) => m[1]);
            assert.deepStrictEqual(panes, ['0', '1', '2'], 'every scene is in the page');
            for (const title of ['Press play, you are on the ramp', 'Surf the web with Vibe', 'Lean back and surf what is on', 'Ride', 'Web', 'Watch']) {
                assert.ok(page.includes(title), `${title} is on the page`);
            }
        });

        await check('the CSS: on a phone nothing is hidden; the chips are a row of 44 px links', async () => {
            const r = await t.get('/');
            assert.ok(!/\.pick:has\(#pk-scenes/.test(r.text), 'no per-scene rule in the page');
            const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'surf.css'), 'utf8');
            assert.ok(!/pick-pane \{ display: none/.test(css), 'no scene is hidden');
            assert.match(css, /\.pick-chip \{[^}]*min-height: 44px/, 'a chip is a 44 px target');
            assert.match(css, /\.sf-tiles \{ display: flex; overflow-x: auto;/, 'the three doors are one sideways row');
        });

        await check('the questions are a fold, open in the page and closed on a phone', async () => {
            const r = await t.get('/');
            assert.ok(r.text.includes('<details class="hm-fold hm-fold-block" id="questions-fold" open>'), 'the questions are a fold, open in the page');
            assert.ok(r.text.includes('document.getElementById("questions-fold")'), 'the fold has the script that closes it on a phone');
            assert.match(r.text, /Do I need to install anything to ride\?/);
        });
    } finally {
        await t.close();
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
