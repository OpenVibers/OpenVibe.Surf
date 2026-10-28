'use strict';

/**
 * /api/v1 — the three Surfs:
 *
 *   GET  /api/v1/watch/feed?topic=all|live|clips|moments&cursor=   the merged Live feed, cached 30 s, public
 *   GET  /api/v1/ride/maps                                         Games' surf maps, cached 60 s, public
 *   GET  /api/v1/ride/maps/:id                                     one map and its records
 *   POST /api/v1/web/tasks                                         Surf with Vibe: one Actor task as the person
 *
 * The Watch and Ride reads are public and cacheable. A browser's POST to /api/v1/web is a write: it must be
 * signed in and come from this site's own Origin, it carries the person's token to Actor as a Bearer, and it is
 * never cached. Actor's 4xx refusal keeps its status and its words; an Actor that does not answer is this
 * service's 502.
 */
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');

function ownOrigin(config) {
    try { return new URL(config.baseUrl).origin; } catch { return null; }
}

function createApi(ctx) {
    const { config, feed, ride, web, log } = ctx;
    const r = asyncRouter();
    const origin = ownOrigin(config);

    const problem = (req, res, status, code, detail) => http.sendProblem(res, status, code, { detail, ctx: req.ov });

    // ── Watch: the merged Live feed ─────────────────────────
    r.get('/v1/watch/feed', async (req, res) => {
        try {
            const out = await feed.feed(req.query.topic || 'all', req.query.cursor || null);
            res.set('Cache-Control', 'public, max-age=30');
            return res.json(out);
        } catch (err) {
            if (err && err.code === 'watch.invalid_topic') return problem(req, res, 400, err.code, err.message);
            if (err && err.code === 'watch.invalid_cursor') return problem(req, res, 400, err.code, err.message);
            log.warn('[OpenVibe.Surf] watch feed failed:', (err && err.message) || err);
            return problem(req, res, 502, 'watch.unavailable', 'OpenVibe.Live did not answer. Try again in a moment.');
        }
    });

    // ── Ride: the Games map catalogue ───────────────────────
    r.get('/v1/ride/maps', async (req, res) => {
        try {
            const out = await ride.maps();
            res.set('Cache-Control', 'public, max-age=60');
            return res.json(out);
        } catch (err) {
            log.warn('[OpenVibe.Surf] ride maps failed:', (err && err.message) || err);
            return problem(req, res, 502, 'games.unavailable', 'OpenVibe.Games did not answer. Try again in a moment.');
        }
    });

    r.get('/v1/ride/maps/:id', async (req, res) => {
        try {
            const out = await ride.map(req.params.id);
            res.set('Cache-Control', 'public, max-age=60');
            return res.json(out);
        } catch (err) {
            if (err && err.status === 400) return problem(req, res, 400, err.code || 'ride.invalid_map', err.message);
            log.warn('[OpenVibe.Surf] ride map failed:', (err && err.message) || err);
            return problem(req, res, 502, 'games.unavailable', 'OpenVibe.Games did not answer. Try again in a moment.');
        }
    });

    // ── Web: Surf with Vibe ─────────────────────────────────
    // A person's task is never cacheable, not even the 401/403 that refuses it.
    r.use('/v1/web', (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

    // The person's Network token, from the httpOnly cookie only (never a header a script could set). The SSO
    // middleware has already verified it and, when the cookie had expired, refreshed it: prefer that token so an
    // expired surf_at never reaches Actor.
    function requireToken(req, res, next) {
        const viewer = req.viewer;
        const token = viewer && viewer.kind === 'user' ? viewer.token : null;
        if (!token) return problem(req, res, 401, 'token.required', 'Sign in at openvibe.surf to surf the web with Vibe.');
        req.webToken = token;
        return next();
    }

    // A browser POST to this route must come from this site itself: another site cannot make a signed-in visitor
    // spend their Actor allowance.
    function requireOrigin(req, res, next) {
        const sent = String(req.get('origin') || '');
        if (!origin || sent !== origin) return problem(req, res, 403, 'web.cross_site', 'Surf with Vibe must be started from openvibe.surf itself.');
        return next();
    }

    r.post('/v1/web/tasks', requireToken, requireOrigin, async (req, res) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const query = body.query;
        if (!web.validQuery(query)) return problem(req, res, 400, 'web.invalid_query', 'query must be 3 to 500 characters.');
        try {
            const out = await web.createTask({
                token: req.webToken,
                query,
                idempotencyKey: req.get('idempotency-key') || null,
            });
            res.set('Location', out.page);
            return res.status(201).json(out);
        } catch (err) {
            if (err && err.status >= 400 && err.status < 500) return problem(req, res, err.status, err.code || 'actor.refused', err.detail || err.message);
            log.warn('[OpenVibe.Surf] web task failed:', (err && err.message) || err);
            return problem(req, res, 502, (err && err.code) || 'actor.unavailable', (err && err.message) || 'OpenVibe.Actor did not answer. Try again in a moment.');
        }
    });

    return r;
}

module.exports = { createApi, ownOrigin };
