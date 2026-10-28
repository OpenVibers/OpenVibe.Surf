'use strict';
/**
 * The Surf room's pages (plan 2026-10-28 §5.5, v1): one room, three surfs. Server-rendered and whole without
 * JavaScript; public/js/surf.js adds the TV (HLS in the page, ↑ ↓ and swipe to change channel), the Web form's
 * in-page start, and the home's ticking timer.
 *
 *   home()                          the front door: the run motif, three tiles under one Start, scenes, questions
 *   ride({ maps, games })           every map as a card, and the first one to play
 *   map({ id, map, top, games })    one map: tier, stages, author, the game, its fastest runs
 *   watch({ feed, topic })          the TV: what is on now, the guide (up next), topics
 *   web({ me, query })              Surf with Vibe: ask, and an agent browses for you on a private desk
 *   developers()                    the API
 *   notFound()
 */
const layoutLib = require('../render/layout');
const kit = require('openvibe-shared/kit');
const sc = require('openvibe-shared/showcase');
const rooms = require('openvibe-shared/rooms');

const { layout, esc } = layoutLib;
const ROOM = rooms.get('surf');

const TIER = { 1: 'Beginner', 2: 'Intermediate', 3: 'Hard', 4: 'Advanced', 5: 'Expert', 6: 'Elite' };
const tierLabel = (t) => (TIER[t] ? `Tier ${t} · ${TIER[t]}` : t ? `Tier ${t}` : 'Unrated');
const idSafe = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
/** 61234 → "1:01.234"; 9870 → "9.870". */
function runTime(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || v === null) return null;
    const m = Math.floor(n / 60000), s = Math.floor((n % 60000) / 1000), x = String(Math.round(n % 1000)).padStart(3, '0');
    return m ? `${m}:${String(s).padStart(2, '0')}.${x}` : `${s}.${x}`;
}
const clipLen = (v) => { const n = Number(v); if (!Number.isFinite(n) || v === null) return null; const m = Math.floor(n / 60), s = Math.round(n % 60); return m ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`; };
const signedInName = (me) => (me && me.signedIn && me.user && (me.user.display_name || me.user.username)) || null;

/** The run motif: a first-person view down two ramps, speed lines, the timer and the speed. */
function runMotif() {
    const lines = Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join('');
    return `<div class="sf-run" aria-hidden="true" data-sf-run>
<svg class="sf-run-ramps" viewBox="0 0 400 260" preserveAspectRatio="none"><defs><linearGradient id="sf-rampL" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity=".12"/></linearGradient><linearGradient id="sf-rampR" x1="1" x2="0"><stop offset="0" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity=".12"/></linearGradient></defs>
<path d="M0 260 L170 112 L178 118 L40 260 Z" fill="url(#sf-rampL)"/><path d="M400 260 L230 112 L222 118 L360 260 Z" fill="url(#sf-rampR)"/>
<path d="M170 112 L200 96 L230 112" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/></svg>
<span class="sf-run-speed">${lines}</span>
<span class="sf-run-hud"><b data-sf-timer>0:12.384</b><small><span data-sf-speed>1 284</span> u/s · stage 2/4</small></span>
</div>`;
}

function home() {
    const tiles = `<ul class="sf-tiles" id="sf-tiles">
<li class="sf-tile" id="sf-tile-ride" data-sf-surf="ride"><a href="/ride"><span class="sf-tile-ic">${kit.icon('game')}</span><b>Ride</b><span>CS-style surf in the browser: ramps, a millisecond timer, your ghost and the record.</span><span class="sf-tile-go">Ride a map${kit.icon('chevron')}</span></a></li>
<li class="sf-tile" id="sf-tile-web" data-sf-surf="web"><a href="/web"><span class="sf-tile-ic">${kit.icon('globe')}</span><b>Web</b><span>Surf with Vibe: say what you want, an agent browses for you and reports back with its sources.</span><span class="sf-tile-go">Ask Vibe${kit.icon('chevron')}</span></a></li>
<li class="sf-tile" id="sf-tile-watch" data-sf-surf="watch"><a href="/watch"><span class="sf-tile-ic">${kit.icon('play')}</span><b>Watch</b><span>Lean back: live streams, clips and the week's AI moments, one swipe or ↑ ↓ to change channel.</span><span class="sf-tile-go">Start watching${kit.icon('chevron')}</span></a></li>
</ul>`;
    // The tiles sit right under the hero (sc.room's own html slot comes after the scenes), so they go in before the scenes.
    const room = sc.room({
        room: 'surf',
        hero: {
            title: ROOM.line,
            lede: 'Three surfs in one room. Ride Counter-Strike-style surf maps right in the browser and race the clock, let an agent surf the web for you and bring back what it found, or lean back and surf what is on across OpenVibe.',
            start: { href: '/ride', label: 'Start riding' },
            motif: runMotif(),
        },
        scenes: [
            { title: 'Press play, you are on the ramp', text: 'Air-strafe into the ramp, hold your speed, hit the next one. The timer counts to the millisecond, your best run rides beside you as a ghost, and every finished run lands on the map\'s board.',
                html: `<div class="sf-demo-run"><div class="sf-demo-hud"><span>Stage 3/4</span><b>0:41.207</b><span class="is-good">−0.384</span></div><div class="sf-demo-bar"><i style="width:72%"></i></div><p>Personal best 0:41.591 · World record 0:38.902</p></div>`,
                action: { href: '/ride', label: 'Pick a map' } },
            { title: 'Surf the web with Vibe', text: 'Say what you want: a cheap flight and three things to do, or what people say about a shoe. The agent searches, reads the pages that matter on a private desk, keeps its sources, and finishes with a report you can check.',
                html: `<ol class="sf-demo-steps"><li class="is-done">Searched the web for “Lisbon in March, cheap flights”</li><li class="is-done">Read 4 pages · compared prices on 2 sites</li><li class="is-now">Writing the report with its sources…</li></ol>`,
                action: { href: '/web', label: 'Ask Vibe' } },
            { title: 'Lean back and surf what is on', text: 'Live streams first, then the clips people cut and the AI moments of the week, each saying why it is on. Swipe on a phone or press ↑ ↓ on a keyboard.',
                html: `<div class="sf-demo-tv"><div class="sf-demo-screen"><span class="sf-pill-live">LIVE</span><span>goosely · Night owls: Seattle walk</span></div><ul><li><b>Up next</b> Top AI moment this week</li><li>New clip · Robot build, part 2</li></ul></div>`,
                action: { href: '/watch', label: 'Start watching' } },
        ],
        explore: { title: 'More on Surf', items: [
            { title: 'Ride', text: 'Maps, the timer, records', href: '/ride', icon: 'ov:games' },
            { title: 'Surf with Vibe', text: 'An agent browses for you', href: '/web', icon: 'ov:actor' },
            { title: 'The API', text: 'Feeds, maps and tasks as JSON', href: '/developers', icon: 'ov:code' },
        ] },
        faq: { items: [
            ['Do I need to install anything to ride?', 'No. The maps run in your browser on OpenVibe.Games: a keyboard and mouse (pointer lock); phones get a touch ramp trainer.'],
            ['Does the agent use my accounts?', 'No. It browses on its own private desk, stops at logins and anything that would spend money, and hands over to you. Its steps and sources stay in your Actor tasks.'],
            ['What plays in Watch?', 'OpenVibe.Live: who is live now, the clips people cut and the week\'s AI moments. Live streams open on their channel; clips and moments play right here.'],
        ] },
    });
    const at = room.indexOf('<section class="sc-room-scenes"');
    const body = at < 0 ? room.replace(/<\/div>$/, `${tiles}</div>`) : room.slice(0, at) + tiles + room.slice(at);
    return layout({ title: null, path: '/', body: `<div class="sf-wrap">${body}</div>`, active: '/' });
}

function mapCard(m) {
    const id = String(m.id || '');
    const wr = runTime(m.wrMs);
    return `<li class="sf-map" id="sf-map-${esc(idSafe(id))}" data-sf-map-id="${esc(id)}" data-tier="${esc(m.tier || '')}">
<a class="sf-map-link" href="/ride/${encodeURIComponent(id)}">
<span class="sf-map-art" aria-hidden="true"><i></i><i></i><i></i></span>
<span class="sf-map-body"><span class="sf-tier">${esc(tierLabel(m.tier))}</span><b>${esc(m.name || id || 'Surf map')}</b>
<span class="sf-map-meta">${m.stages == null ? '' : `${esc(m.stages)} stage${Number(m.stages) === 1 ? '' : 's'}`}${m.records != null ? ` · ${esc(m.records)} run${Number(m.records) === 1 ? '' : 's'}` : ''}</span>
<span class="sf-wr">${wr ? `Record <b>${esc(wr)}</b>${m.wrHolder ? ` · ${esc(m.wrHolder)}` : ''}` : 'No record yet: set the first one'}</span></span>
</a></li>`;
}

function gameFrame(m, name) {
    if (!m || !m.embed_url) return '';
    return `<div class="sf-game" id="sf-embed" data-sf-embed data-sf-map-id="${esc(m.id || '')}">
<iframe src="${esc(m.embed_url)}" title="${esc(`${name}: play in OpenVibe.Games`)}" loading="lazy" allow="fullscreen; gamepad; pointer-lock" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</div><p class="sf-fine sf-game-help">Click the game to start: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> and the mouse to strafe, <kbd>R</kbd> to restart, <kbd>G</kbd> for your ghost. <a href="${esc(m.embed_url.replace(/[?&]embed=1/, ''))}">Open it full screen</a></p>`;
}

const gamesNote = (games) => (games === 'not_ready' ? 'OpenVibe.Games is building the surf maps right now. They appear here the moment they are ready.'
    : games === 'unavailable' ? 'OpenVibe.Games did not answer just now. Try again in a moment.' : 'No maps are listed right now.');

function ride({ maps = [], games = 'ready' } = {}) {
    const list = Array.isArray(maps) ? maps : [];
    const first = list[0] || null;
    const body = `<div class="sf-wrap sf-page-pad">
<header class="sf-page-h"><p class="sf-kicker">Ride</p><h1>Pick a ramp</h1>
<p class="sf-lede">Counter-Strike-style surf in the browser. Each map has stages, a millisecond timer and a board of the fastest runs${first ? '; the first one is ready to play below' : ''}.</p></header>
<section id="sf-ride" aria-labelledby="sf-maps-h"><h2 id="sf-maps-h" class="sf-sr">Maps</h2>
${list.length ? `<ul class="sf-maps" id="sf-maps">${list.map(mapCard).join('')}</ul>` : `<div class="sf-empty" id="sf-maps-empty">${kit.icon('game')}<p>${esc(gamesNote(games))}</p></div>`}
</section>
${first ? `<section id="sf-ride-embed" aria-labelledby="sf-embed-h" class="sf-play"><div class="sf-head-row"><h2 id="sf-embed-h">${esc(first.name || 'Play')}</h2><a class="sf-more" href="/ride/${encodeURIComponent(first.id)}">Records${kit.icon('chevron')}</a></div>${gameFrame(first, first.name || 'Surf map')}</section>` : ''}
</div>`;
    return layout({ title: 'Ride', description: 'Counter-Strike-style surf maps in the browser: stages, a millisecond timer, ghosts and records.', path: '/ride', body, active: '/ride' });
}

function map({ id, map: m = null, top = [], games = 'ready' } = {}) {
    const one = m || { id };
    const name = one.name || String(id || '');
    const rows = (Array.isArray(top) ? top : []).map((r, i) => `<tr${i === 0 ? ' class="is-wr"' : ''}><td>${esc(r.rank == null ? i + 1 : r.rank)}</td><td>${esc(r.name || '')}</td><td class="sf-time">${esc(runTime(r.timeMs) || '')}</td></tr>`).join('');
    const body = `<div class="sf-wrap sf-page-pad">
<header class="sf-page-h sf-map-h" id="sf-map" data-sf-map-id="${esc(id || one.id || '')}"><p class="sf-kicker"><a href="/ride">Ride</a> · ${esc(tierLabel(one.tier))}</p><h1>${esc(name)}</h1>
<p class="sf-lede">${one.stages == null ? '' : `${esc(one.stages)} stage${Number(one.stages) === 1 ? '' : 's'}`}${one.records != null ? ` · ${esc(one.records)} run${Number(one.records) === 1 ? '' : 's'}` : ''}${one.author ? ` · by ${esc(one.author)}` : ''}${one.wrMs != null ? ` · record <b>${esc(runTime(one.wrMs))}</b>${one.wrHolder ? ` by ${esc(one.wrHolder)}` : ''}` : ''}</p></header>
${games === 'not_ready' ? `<p class="sf-note" id="sf-ride-not-ready">${esc(gamesNote(games))}</p>` : ''}
<div class="sf-map-grid">
<section id="sf-map-embed" aria-label="Play">${gameFrame(one, name) || `<div class="sf-empty">${kit.icon('game')}<p>This map cannot be played here right now.</p></div>`}</section>
<section id="sf-map-records" class="sf-card" aria-labelledby="sf-records-h"><h2 id="sf-records-h">${kit.icon('trophy')}Fastest runs</h2>
${rows ? `<table class="sf-board" id="sf-top"><thead><tr><th scope="col">#</th><th scope="col">Rider</th><th scope="col">Time</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="sf-fine" id="sf-top-empty">${games === 'ready' ? 'No runs yet. Finish it once and you hold the record.' : esc(gamesNote(games))}</p>`}
</section></div>
</div>`;
    return layout({ title: `${name}: Ride`, description: `${name}: a surf map you ride in the browser, with stages, a millisecond timer and records.`, path: `/ride/${encodeURIComponent(id || one.id || '')}`, body, active: '/ride' });
}

function watch({ feed = null, topic = 'all' } = {}) {
    const items = feed && Array.isArray(feed.items) ? feed.items : [];
    const tabs = [['all', 'All'], ['live', 'Live'], ['clips', 'Clips'], ['moments', 'AI moments']].map(([id, label]) =>
        `<a class="sf-topic" href="/watch?topic=${id}"${id === topic ? ' aria-current="page"' : ''}>${label}</a>`).join('');
    const first = items[0] || null;
    const kindOf = (it) => (it.kind === 'moment' ? 'moment' : it.kind === 'clip' ? 'clip' : 'live');
    const label = { live: 'Live', clip: 'Clip', moment: 'AI moment' };
    const stage = first ? (() => {
        const k = kindOf(first);
        const p = first.play || {};
        const media = p.type === 'hls' && p.src
            ? `<video class="sf-tv-video" data-sf-video playsinline controls preload="none" poster="${esc(first.thumbnail || '')}" src="${esc(p.src)}"></video>`
            : `${first.thumbnail ? `<img class="sf-tv-poster" src="${esc(first.thumbnail)}" alt="" loading="eager">` : '<span class="sf-tv-poster"></span>'}<a class="sf-tv-out" href="${esc(p.page || '#')}">${kit.icon('play')}${k === 'live' ? 'Watch live on OpenVibe.Live' : 'Play on OpenVibe.Live'}</a>`;
        return `<div class="sf-tv-main"><div class="sf-tv-screen" data-sf-screen>${media}</div>
<div class="sf-tv-info"><p class="sf-tv-kind"><span class="sf-pill sf-pill--${esc(k)}">${esc(label[k])}</span><span data-sf-why>${esc(first.why || '')}</span></p>
<h2 data-sf-title>${esc(first.title || '')}</h2>
<p class="sf-tv-meta" data-sf-meta>${first.channel && first.channel.username ? `<a href="https://openvibe.live/@${encodeURIComponent(first.channel.username)}">@${esc(first.channel.username)}</a>` : ''}</p>
<p class="sf-tv-keys"><button type="button" class="ovk-btn ovk-btn--quiet ovk-btn--small" data-sf-prev aria-label="Previous channel">${kit.icon('up')}</button><button type="button" class="ovk-btn ovk-btn--quiet ovk-btn--small" data-sf-next aria-label="Next channel">${kit.icon('down')}</button><span class="sf-fine">Swipe, or press <kbd>↑</kbd> <kbd>↓</kbd></span></p></div></div>`;
    })() : '';
    const rows = items.map((it, i) => {
        const k = kindOf(it);
        const p = it.play || {};
        return `<li class="sf-ch${i === 0 ? ' is-on' : ''}" id="sf-item-${esc(idSafe(it.key))}" data-sf-i="${i}" data-sf-kind="${esc(k)}" data-sf-play-type="${esc(p.type || '')}"${p.src ? ` data-sf-src="${esc(p.src)}"` : ''} data-sf-page="${esc(p.page || '')}" data-sf-thumb="${esc(it.thumbnail || '')}" data-sf-why="${esc(it.why || '')}" data-sf-channel="${esc((it.channel && it.channel.username) || '')}">
<a class="sf-ch-link" href="${esc(p.page || '#')}">
<span class="sf-ch-thumb">${it.thumbnail ? `<img src="${esc(it.thumbnail)}" alt="" loading="lazy" decoding="async">` : ''}${it.duration_seconds != null ? `<span class="sf-ch-len">${esc(clipLen(it.duration_seconds))}</span>` : ''}${k === 'live' ? '<span class="sf-ch-live">LIVE</span>' : ''}</span>
<span class="sf-ch-body"><b>${esc(it.title || '')}</b><small>${it.channel && it.channel.username ? `@${esc(it.channel.username)} · ` : ''}${esc(it.why || label[k])}</small></span>
</a></li>`;
    }).join('');
    const missing = feed && feed.sources ? Object.entries(feed.sources).filter(([, v]) => v !== 'ok').map(([k]) => k) : [];
    const body = `<div class="sf-wrap sf-page-pad">
<header class="sf-page-h sf-watch-h"><div><p class="sf-kicker">Watch</p><h1>Surf what's on</h1></div><nav class="sf-topics" id="sf-topics" aria-label="What to watch">${tabs}</nav></header>
${missing.length ? `<p class="sf-note" id="sf-sources">Some of OpenVibe.Live did not answer (${esc(missing.join(', '))}); the rest is here.</p>` : ''}
${items.length ? `<div class="sf-tv" id="sf-tv" data-sf-tv>${stage}<aside class="sf-guide" aria-labelledby="sf-guide-h"><h2 id="sf-guide-h">Up next</h2><ol class="sf-chs" id="sf-watch-feed">${rows}</ol>
${feed && feed.next ? `<a class="sf-more" id="sf-watch-next" href="/watch?topic=${esc(topic)}&amp;cursor=${esc(feed.next)}">More${kit.icon('chevron')}</a>` : ''}</aside></div>`
        : `<div class="sf-empty" id="sf-watch-empty">${kit.icon('play')}<p>${feed ? 'Nothing on this channel right now. Try another, or come back soon.' : 'OpenVibe.Live did not answer. Try again in a moment.'}</p></div>`}
</div>`;
    return layout({ title: 'Watch', description: 'Lean-back channel surfing over OpenVibe.Live: who is live, clips and the week\'s AI moments in one feed.', path: '/watch', body, active: '/watch' });
}

const EXAMPLES = ['A cheap flight to Lisbon in March and three things to do', 'What do runners say about the Pegasus 42?', 'Compare three hosting plans under $10 a month'];

function web({ me = {}, query = '' } = {}) {
    const who = signedInName(me);
    const body = `<div class="sf-wrap sf-page-pad sf-narrow">
<header class="sf-page-h"><p class="sf-kicker">Web · Surf with Vibe</p><h1>Tell it what to find</h1>
<p class="sf-lede">An agent surfs the web for you: it searches, reads the pages that matter on a private desk when a page needs a real browser, keeps its sources, and finishes with a short report that cites them.</p></header>
<section id="sf-web" class="sf-card" aria-labelledby="sf-web-h"><h2 id="sf-web-h" class="sf-sr">What should Vibe find?</h2>
<form class="sf-web-form" id="sf-web-form" data-sf-web-form action="/web/go" method="post">
<label for="sf-web-query" class="sf-sr">What should Vibe find?</label>
<textarea id="sf-web-query" name="q" rows="3" minlength="3" maxlength="500" required spellcheck="true" placeholder="e.g. a cheap flight to Lisbon in March and three things to do">${esc(query)}</textarea>
<div class="sf-web-row"><span class="sf-fine" id="sf-web-who">${who ? `Runs as <b>${esc(who)}</b>, on your OpenVibe allowance.` : 'You will be asked to sign in first.'}</span>
<button class="ovk-btn ovk-btn--primary" id="sf-web-submit" type="submit">${kit.icon('globe')}Surf it</button></div>
</form>
<p class="sf-status" id="sf-web-status" role="status"></p>
<div class="sf-examples" aria-label="Try one">${EXAMPLES.map((x) => `<button type="button" class="sf-ex" data-sf-example="${esc(x)}">${esc(x)}</button>`).join('')}</div>
</section>
<section id="sf-web-how" aria-labelledby="sf-web-how-h"><h2 id="sf-web-how-h">What happens next</h2>
<ol class="sf-how">
<li><b>It searches.</b><span>The web first through OpenVibe's Search Fabric, so it starts with what is known and cited.</span></li>
<li><b>It reads.</b><span>It opens the pages that matter, and a private desk when a page needs a real browser. You can watch the desk live and take over.</span></li>
<li><b>It reports.</b><span>A short answer with every source it used, in your Actor tasks and in the Action Center.</span></li>
</ol>
<p class="sf-fine">It never signs in or pays for you: at a login, a captcha or a checkout it stops and hands over. OpenVibe.Surf keeps neither your question nor the report; the task is yours at OpenVibe.Actor.</p></section>
</div>`;
    return layout({ title: 'Surf with Vibe', description: 'Ask an agent to surf the web for you: it searches, reads pages on a private desk when needed, keeps its sources and reports back with citations.', path: '/web', body, active: '/web' });
}

function developers() {
    const rows = [
        ['GET /api/v1/watch/feed?topic=all|live|clips|moments&amp;cursor=', 'The merged OpenVibe.Live feed: who is live (by viewers), then clips and AI moments by freshness, never two from one channel in a row. Each item says why it is on. Cached 30 s; a source that did not answer is named in <code>sources</code>.'],
        ['GET /api/v1/ride/maps', 'The surf maps from OpenVibe.Games: id, name, tier, stages, author, runs, the record. Cached 60 s.'],
        ['GET /api/v1/ride/maps/:id', 'One map, its fastest runs and its <code>embed_url</code>.'],
        ['POST /api/v1/web/tasks', 'Signed in, from this site: <code>{ query }</code> (3–500 characters) starts an OpenVibe.Actor task as you and answers <code>{ task_id, page }</code>.'],
    ];
    const body = `<div class="sf-wrap sf-page-pad">
<header class="sf-page-h"><p class="sf-kicker">For developers</p><h1>The Surf API</h1>
<p class="sf-lede">Watch and Ride are public reads; Web starts a task at OpenVibe.Actor as the signed-in person. Errors are RFC 9457 <code>application/problem+json</code>.</p></header>
<dl class="sf-eps">${rows.map(([ep, what]) => `<div><dt><code>${ep}</code></dt><dd>${what}</dd></div>`).join('')}</dl>
</div>`;
    return layout({ title: 'The Surf API', path: '/developers', body, active: '/developers' });
}

function notFound() {
    const body = `<div class="sf-wrap sf-page-pad sf-narrow"><div class="sf-empty" id="sf-not-found">${kit.icon('game')}<h1>Wiped out</h1><p>There is nothing at this address. Try <a href="/ride">a map</a>, <a href="/watch">what's on</a> or <a href="/web">asking Vibe</a>.</p></div></div>`;
    return layout({ title: 'Not found', robots: 'noindex, follow', body, active: '/' });
}

module.exports = {
    home, ride, map, watch, web, developers, notFound, runTime,
    layout,
    setRelease: layoutLib.setRelease,
    configure: layoutLib.configure,
};
