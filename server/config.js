'use strict';

/**
 * OpenVibe.Surf configuration. Every value comes from the environment (production:
 * /etc/openvibe/surf.env, see .env.example). Only environment variable NAMES appear in code and docs; secrets are
 * never logged.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();

const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const atLeast = (v, min, def) => Math.max(min, int(v, def));

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 5110);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://openvibe.surf' : `http://localhost:${port}`));
    // The Network's public origin is where a browser is sent to authorize. Its internal origin is where this
    // service exchanges the code and fetches the JWKS; neither a person's browser nor their token talks to it
    // directly.
    const networkPublicUrl = trim(env.OV_NETWORK_URL || 'https://openvibe.network');
    const networkInternalUrl = trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000');

    return {
        service: 'surf',
        name: 'OpenVibe.Surf',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 2,

        // OpenVibe.Network: sign-in (OAuth client `surf`, PKCE S256) and its JWKS.
        networkUrl: networkInternalUrl,
        networkPublicUrl,
        networkInternalUrl,
        networkIssuer: trim(env.OV_NETWORK_ISSUER || networkPublicUrl),

        // The three rooms this front joins. `public` origins are what a person's browser is sent to; the internal
        // origins are what this process may call. A person's Network token only ever goes to the configured Actor.
        liveInternalUrl: trim(env.OV_LIVE_INTERNAL_URL || 'http://127.0.0.1:3000'),
        livePublicUrl: trim(env.SURF_LIVE_PUBLIC_URL || 'https://openvibe.live'),
        gamesInternalUrl: trim(env.OV_GAMES_INTERNAL_URL || 'http://127.0.0.1:8000'),
        gamesPublicUrl: trim(env.SURF_GAMES_PUBLIC_URL || 'https://openvibe.games'),
        actorInternalUrl: trim(env.OV_ACTOR_INTERNAL_URL || 'http://127.0.0.1:4950'),
        actorPublicUrl: trim(env.SURF_ACTOR_PUBLIC_URL || 'https://openvibe.actor'),

        // Watch: the merged feed is cached 30 s; each Live source gets 2 s before it is left out.
        watchCacheMs: Math.max(0, int(env.SURF_WATCH_CACHE_MS, 30_000)),
        watchSourceTimeoutMs: atLeast(env.SURF_WATCH_SOURCE_TIMEOUT_MS, 200, 2000),
        // Ride: maps are cached 60 s; Games has a little longer than one Live source to answer.
        rideCacheMs: Math.max(0, int(env.SURF_RIDE_CACHE_MS, 60_000)),
        gamesTimeoutMs: atLeast(env.SURF_GAMES_TIMEOUT_MS, 200, 4000),
        // Web: Actor creates a task quickly, but a cold allowance check may take a moment.
        actorTimeoutMs: atLeast(env.SURF_ACTOR_TIMEOUT_MS, 200, 15_000),
        // Watch together: in-memory parties, hard caps 200 open parties and 50 members each. The environment may
        // lower the caps (tests do), never raise them; the 30-minute empty TTL is fixed in watch/party.js.
        partyMax: Math.min(200, Math.max(1, int(env.SURF_PARTY_MAX, 200))),
        partyMemberMax: Math.min(50, Math.max(1, int(env.SURF_PARTY_MEMBER_MAX, 50))),

        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'surf',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile',
            sessionAudience: env.OV_SESSION_AUDIENCE || 'openvibe.network',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },

        // One per-IP budget for /api and /auth (express-rate-limit, one 60 s window).
        rateLimitPerMinute: Math.max(1, int(env.SURF_RATE_LIMIT_PER_MIN, 120)),
    };
}

module.exports = { load };
