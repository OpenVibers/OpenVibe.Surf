'use strict';
/**
 * The home on a phone (the owner's short-pages rule, 2026-10-30): the three scenes are a pick block, a row of chips
 * picks one of them, and the questions are a fold. Radio inputs and :has(), no script for the chips; every scene stays
 * in the page for crawlers; a wider screen shows them all and no chips.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('the scenes are chips: one per scene, the first picked, every scene in the page', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200, r.text);
            const page = r.text;
            assert.ok(page.includes('<div class="pick" id="pick-scenes">'), 'the pick block is on the home');
            const block = page.slice(page.indexOf('<div class="pick" id="pick-scenes">'));
            const chips = [...block.matchAll(/<input type="radio" name="pick-scenes" id="pk-scenes-(scene-\d+)" value="\1"( checked)?><label for="pk-scenes-\1">([^<]+)<\/label>/g)];
            assert.deepStrictEqual(chips.map((m) => m[1]), ['scene-0', 'scene-1', 'scene-2'], 'a chip per scene');
            assert.deepStrictEqual(chips.filter((m) => m[2]).map((m) => m[1]), ['scene-0'], 'the first scene is picked');
            const panes = [...block.matchAll(/<div class="pick-pane" id="scene-(\d+)">/g)].map((m) => m[1]);
            assert.deepStrictEqual(panes, ['0', '1', '2'], 'every scene is in the page, one per chip');
            // Nothing was removed: the scenes and the doors are still there.
            for (const title of ['Press play, you are on the ramp', 'Surf the web with Vibe', 'Lean back and surf what is on', 'Ride', 'Web', 'Watch']) {
                assert.ok(page.includes(title), `${title} is on the page`);
            }
        });

        await check('the CSS guard: the chips are hidden and every scene shows until 640 px and where :has() is understood', async () => {
            const r = await t.get('/');
            assert.match(r.text, /<style>@supports selector\(:has\(\*\)\)\{@media \(max-width:640px\)\{\.pick:has\(#pk-scenes-scene-0:checked\) #scene-0\{display:block\}/, 'the rule that shows the picked scene');
            const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'surf.css'), 'utf8');
            assert.match(css, /\.pick-row \{ display: none; \}/, 'the chips are hidden by default');
            assert.match(css, /@supports selector\(:has\(\*\)\) \{ @media \(max-width: 640px\) \{/, 'the phone rules are under :has() and 640 px');
            assert.match(css, /\.pick-row label \{[^}]*min-height: 44px/, 'a chip is a 44 px target');
            assert.match(css, /\.pick \.pick-pane \{ display: none; \}/, 'the scenes are hidden on a phone');
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
