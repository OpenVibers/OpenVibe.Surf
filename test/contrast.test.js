'use strict';
// WCAG 2.1 AA: the demo HUD is always dark, so the theme's success text (dark green on light themes) was 3.5:1
// there. The HUD now pins the kit's #4ade80 instead of the theme token.
//   node test/contrast.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'surf.css'), 'utf8');
assert.ok(
    css.includes('.sf-demo-hud .is-good { color: #4ade80; font-variant-numeric: tabular-nums; }'),
    'the demo HUD keeps the kit success green whatever the theme'
);
assert.ok(!css.includes('.sf-demo-hud .is-good { color: var(--success-text, #4ade80);'), 'the demo HUD no longer takes the theme success text');
console.log('contrast: the demo HUD reads on every theme');
