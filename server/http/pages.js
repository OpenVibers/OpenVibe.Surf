'use strict';

/**
 * The public pages:
 *   /                 the front door: Ride, Watch, Web
 *   /ride             the maps list and the embed of the first map
 *   /ride/:map        one map: name, tier, stages, records, the embed
 *   /watch            the merged Live feed as a list with thumbnails and play links
 *   /web              the Surf with Vibe form and what it does
 *   /web/go          the no-JavaScript form: create the task, 303 to its Surf page
 *   /web/t/:taskId   a person's live desk, steps, sources and report
 *   /developers       the API, for people and agents
 *
 * Every page is server-rendered and complete without JavaScript. A page for a signed-in person is private and
 * never cached; a public page gets the short 60-second window. `me` comes from the session the SSO middleware
 * already resolved — a guest never causes a Network call to find out they are a guest.
 */
const views = require('../views');
const { asyncRouter } = require('./router');
const { send } = require('../render/layout');
const { ACCESS_COOKIE } = require('../auth/sso');
const express = require('express');
const { ownOrigin } = require('./api');

const TOPICS = new Set(['all', 'live', 'clips', 'moments']);

function meOf(viewer) {
    if (!viewer || viewer.kind !== 'user') return { signedIn: false, user: null };
    return {
        signedIn: true,
        user: {
            subject_id: viewer.subject || null,
            username: viewer.username || null,
            display_name: viewer.displayName || null,
            role: viewer.role || 'user',
            avatar_url: viewer.avatarUrl || null,
            profile_color: viewer.profileColor || null,
        },
    };
}

function createPageRoutes(ctx) {
    const { feed, ride, web, log, config } = ctx;
    const r = asyncRouter();
    // An upstream never throws in a page: a failure degrades to the page without its data.
    const safe = (fn) => Promise.resolve().then(fn).catch((err) => {
        log.warn('[OpenVibe.Surf] page upstream failed:', (err && err.message) || err);
        return null;
    });
    const page = (res, status, html, viewer) => send(res, status, html, { viewer });

    r.get('/', (req, res) => page(res, 200, views.home(), req.viewer));

    r.get('/ride', async (req, res) => {
        const out = await safe(() => ride.maps());
        return page(res, 200, views.ride({ maps: out ? out.maps : [], games: out ? out.games : 'unavailable' }), req.viewer);
    });

    r.get('/ride/:map', async (req, res) => {
        const id = String(req.params.map || '').slice(0, 64);
        const out = await safe(() => ride.map(id));
        return page(res, 200, views.map({
            id,
            map: out ? out.map : { id, embed_url: ride.embedUrl(id) },
            top: out ? out.top : [],
            games: out ? out.games : 'unavailable',
        }), req.viewer);
    });

    r.get('/watch', async (req, res) => {
        const topic = TOPICS.has(String(req.query.topic || '')) ? String(req.query.topic) : 'all';
        let out = null;
        try {
            out = await feed.feed(topic, req.query.cursor || null);
        } catch (err) {
            // A stale or hand-edited cursor is not a page-level failure: show the first page instead of a 400.
            if (err && err.code === 'watch.invalid_cursor') {
                out = await safe(() => feed.feed(topic, null));
            } else {
                log.warn('[OpenVibe.Surf] watch page failed:', (err && err.message) || err);
            }
        }
        return page(res, 200, views.watch({ feed: out, topic }), req.viewer);
    });

    r.get('/web', (req, res) => page(res, 200, views.web({ me: meOf(req.viewer), query: typeof req.query.q === 'string' ? req.query.q.slice(0, 500) : '' }), req.viewer));

    r.get('/web/t/:taskId', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const token = req.viewer && req.viewer.kind === 'user' ? req.viewer.token : null;
        if (!token) return res.redirect(303, `/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
        try {
            const task = await web.task({ token, id: req.params.taskId });
            return page(res, 200, views.webTask({ task, actorUrl: config.actorPublicUrl }), req.viewer);
        } catch (err) {
            return page(res, err.status === 404 ? 404 : 502, views.webTaskError({ notFound: err.status === 404 }), req.viewer);
        }
    });

    // The no-JavaScript form: a POST from this site that creates one task and goes to it (303). The query is in the
    // body, never in a URL (so never in a log); another site's form is refused by its Origin.
    r.get('/web/go', (req, res) => res.redirect(303, '/web'));
    r.post('/web/go', express.urlencoded({ extended: false, limit: '8kb' }), async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const origin = String(req.get('origin') || '');
        const site = String(req.get('sec-fetch-site') || '');
        if ((origin && origin !== ownOrigin(config)) || (site && site !== 'same-origin' && site !== 'none')) {
            return res.status(403).type('text/plain').send('Surf with Vibe starts from openvibe.surf itself.');
        }
        const query = typeof (req.body || {}).q === 'string' ? req.body.q.trim() : '';
        if (!web.validQuery(query)) return page(res, 400, views.web({ me: meOf(req.viewer), query }), req.viewer);
        const token = req.viewer && req.viewer.kind === 'user' ? (req.viewer.token || (req.cookies && req.cookies[ACCESS_COOKIE])) : null;
        if (!token) return res.redirect(303, '/auth/login?next=%2Fweb');
        try {
            const out = await web.createTask({ token, query, idempotencyKey: null });
            return res.redirect(303, out.page);
        } catch (err) {
            if (err && err.status >= 400 && err.status < 500) {
                return res.status(err.status).type('text/plain').send(`OpenVibe.Actor could not take that task: ${String(err.detail || err.message || 'refused').slice(0, 400)}`);
            }
            log.warn('[OpenVibe.Surf] web form failed:', (err && err.message) || err);
            return res.status(502).type('text/plain').send('OpenVibe.Actor did not answer. Go back to /web and try again in a moment.');
        }
    });

    r.get('/developers', (req, res) => page(res, 200, views.developers(), req.viewer));

    r.use((req, res) => page(res, 404, views.notFound(), req.viewer));
    return r;
}

module.exports = { createPageRoutes, meOf };
