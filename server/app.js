'use strict';

/**
 * OpenVibe.Surf — Express app factory; server/index.js listens, tests build their own instance with mock upstreams.
 *
 *   /, /ride, /ride/:map, /watch, /web, /developers   the pages (http/pages.js)
 *   /web/go                                           the no-JavaScript task form
 *   /api/v1/watch/feed, /api/v1/ride/maps…            Watch and Ride (http/api.js)
 *   /api/v1/web/tasks                                 Surf with Vibe (http/api.js)
 *   /auth/*                                           Network SSO with PKCE (auth/sso.js)
 *   /api/health, /api/ready, /release.json            liveness, truthful readiness, release metadata
 *   /robots.txt, /sitemap.xml, /llms.txt              crawl artifacts (http/discovery.js)
 *
 * Stateless: no database, no Valkey, no Events. The dependencies are OpenVibe.Network (sign-in), OpenVibe.Live
 * (Watch), OpenVibe.Games (Ride) and OpenVibe.Actor (Web); the pages degrade honestly without any of them.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const contracts = require('openvibe-contracts');
const cache = require('openvibe-shared/cache-policy');
const releaseLib = require('openvibe-shared/release');
const metricsLib = require('openvibe-shared/metrics');
const serve = require('openvibe-shared/serve');

const configLib = require('./config');
const { createKeyStore } = require('./auth/keys');
const { createSso } = require('./auth/sso');
const { createWatchFeed } = require('./watch/feed');
const { createRide } = require('./ride/games');
const { createWeb } = require('./web/tasks');
const { createApi } = require('./http/api');
const { createPageRoutes } = require('./http/pages');
const { createDiscoveryRoutes } = require('./http/discovery');
const { createServiceReadiness } = require('./observability');
const { PUBLIC_DIR, assetVersion } = require('./assets');
const views = require('./views');

const VERSION = require('../package.json').version;

/**
 * opts: config, fetchImpl, log, now, release
 * A test passes a fetchImpl that talks to in-process Network/Live/Games/Actor stand-ins.
 */
function createApp(opts = {}) {
    const config = opts.config || configLib.load();
    const log = opts.log || console;
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const now = opts.now || (() => Date.now());

    const keys = createKeyStore({ config, fetchImpl, log });
    const sso = createSso({ config, keys, fetchImpl, log, now });
    const feed = createWatchFeed({ config, fetchImpl, log, now });
    const ride = createRide({ config, fetchImpl, log, now });
    const web = createWeb({ config, fetchImpl, log });
    const ctx = { config, keys, sso, feed, ride, web, log };

    const release = opts.release || releaseLib.createRelease({ service: 'surf', root: path.join(__dirname, '..') });
    views.setRelease(release.release);
    views.configure({ baseUrl: config.baseUrl });

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.locals.ctx = ctx;

    const metrics = metricsLib.instrument(app, { service: 'surf', release: release.release });
    app.locals.metrics = metrics.registry;
    release.mount(app, { registry: metrics.registry });

    // ── Machine endpoints ───────────────────────────────────
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-surf', version: VERSION }));
    const readiness = createServiceReadiness({ config, feed, ride, keys, release: release.release, fetchImpl });
    app.get('/api/ready', readiness.handler);

    app.use(contracts.http.middleware());
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // The OpenVibe Frame (theme-loader, navbar, footer) comes from the Network; the inline init is ours.
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://static.cloudflareinsights.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
                // Card thumbnails and avatars are https images on the media edge; the catalogue may carry any https image.
                imgSrc: ["'self'", 'data:', 'https:'],
                // The footer's release line hears OpenVibe.Events; Cloudflare's beacon reports page timings.
                // hls.js fetches Media's playlists and segments, which may redirect to R2 or B2 (as openvibe.video's CSP).
                connectSrc: ["'self'", 'https://openvibe.network', 'https://cloudflareinsights.com', 'https://openvibe.events', 'https://openvibe.media', 'https://edge.openvibe.media', 'https://*.r2.cloudflarestorage.com', 'https://*.backblazeb2.com'],
                // Ride embeds a Games map; Watch may embed Live's player when Live has one.
                frameSrc: ["'self'", 'https://openvibe.games', 'https://openvibe.live'],
                // HLS clips play from the media edge (and a blob: URL a player may build).
                mediaSrc: ["'self'", 'https://openvibe.media', 'https://edge.openvibe.media', 'https://*.r2.cloudflarestorage.com', 'https://*.backblazeb2.com', 'blob:'],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", 'https://openvibe.network'],
            },
        },
        frameguard: { action: 'deny' },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-site' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));
    app.use(cookieParser());

    // ── Per-IP budget for the API and sign-in (120 a minute) ─
    const limiter = rateLimit({
        windowMs: 60_000,
        limit: config.rateLimitPerMinute || 120,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => contracts.http.sendProblem(res, 429, 'rate_limited', {
            detail: 'too many requests from this address; retry shortly',
            ctx: req.ov,
        }),
    });
    app.use(['/api', '/auth'], limiter);

    // ── Who is signed in, then sign-in itself ───────────────
    app.use(sso.middleware());
    app.use('/auth', sso.routes());

    // ── Static assets (content-hashed ?v= → immutable) ──────
    app.use('/shared', serve.handler());
    const setAssetHeaders = (res, filePath) => {
        const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
        const v = res.req && res.req.query && res.req.query.v;
        res.setHeader('Cache-Control', cache.assetHeaders(rel, { hashed: Boolean(v) && v === assetVersion(rel) }));
    };
    app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), { index: false, redirect: false, setHeaders: setAssetHeaders }));
    app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), { index: false, redirect: false, setHeaders: setAssetHeaders }));
    // hls.js 1.7.3 light (the same file openvibe.video serves), loaded by js/surf.js only where a browser cannot play HLS.
    app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), { index: false, redirect: false, setHeaders: setAssetHeaders }));

    // ── API: Watch, Ride and Web ────────────────────────────
    app.use('/api', express.json({ limit: '32kb' }));
    app.use('/api', createApi(ctx));
    app.use('/api', (req, res) => contracts.http.sendProblem(res, 404, 'route.not_found', {
        detail: 'No such API route.',
        ctx: req.ov,
    }));

    // ── Crawl artifacts ─────────────────────────────────────
    app.use(createDiscoveryRoutes(ctx));

    // ── Pages (and the no-JavaScript task form) ─────────────
    app.use(createPageRoutes(ctx));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        // Never log request bodies (a query is personal, and a token can be in a header).
        log.error('[OpenVibe.Surf]', err && err.message ? err.message.slice(0, 300) : err);
        if (res.headersSent) return;
        res.set('Cache-Control', 'no-store');
        if (err && err.type === 'entity.parse.failed') return contracts.http.sendProblem(res, 400, 'request.malformed_json', { ctx: req.ov });
        if (err && err.type === 'entity.too.large') return req.path.startsWith('/api/') ? contracts.http.sendProblem(res, 413, 'request.too_large', { ctx: req.ov }) : res.status(413).type('text/plain').send('That request was too large.');
        if (req.path.startsWith('/api/')) return contracts.http.sendProblem(res, 500, 'internal.error', { detail: 'Internal error', ctx: req.ov });
        return res.status(500).type('text/plain').send('Something went wrong on our side. Try again in a moment.');
    });

    return { app, ctx };
}

module.exports = { createApp };
