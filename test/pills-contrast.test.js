'use strict';
// axe on /watch (browser check, 11-15): the room pills and the LIVE badge on a channel. White on a theme's live red
// (#ef4444) is 3.8:1, so the badge's red is a fifth darker; a pill's room colour leans toward the text colour.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'surf.css'), 'utf8');
assert.match(css, /\.sf-pill \{[^}]*color: color-mix\(in srgb, var\(--room-strong\) 60%, var\(--text-primary, #e6edf7\)\);/);
assert.match(css, /\.sf-ch-live \{[^}]*background: color-mix\(in srgb, var\(--live-red, #e11d48\), #000 20%\);/);
console.log('surf pills contrast: the room pills lean toward the text, the LIVE badge is a darker red');
