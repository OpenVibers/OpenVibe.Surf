'use strict';

/**
 * Truthful readiness for GET /api/ready (openvibe-shared/ready). There is no database: the service is stateless.
 *
 *   network        optional  OpenVibe.Network answers its health route
 *   network_jwks   optional  the Network signing key is loaded; without it nobody can sign in
 *   oauth_client   optional  OV_OAUTH_CLIENT_SECRET is set (sign-in needs it)
 *   live           optional  OpenVibe.Live answers
 *   games          optional  OpenVibe.Games answers (a 404 for the new surf routes still means it is up)
 *   actor          optional  OpenVibe.Actor answers; Web cannot create a task without it
 *
 * No check is required: if an upstream does not answer, the process still serves the pages and degrades honestly,
 * so the answer is 200 with status "degraded" — never 503.
 */
const { createReadiness } = require('openvibe-shared/ready');

function createServiceReadiness({ config, feed, ride, keys = null, release = null, fetchImpl = globalThis.fetch }) {
    return createReadiness({
        service: 'surf',
        release,
        checks: [
            {
                name: 'network',
                required: false,
                check: async () => {
                    const base = config.networkInternalUrl || config.networkUrl;
                    const fetchOnce = (p) => fetchImpl(`${base}${p}`, {
                        headers: { Accept: 'application/json' },
                        signal: AbortSignal.timeout(2000),
                    });
                    let res = await fetchOnce('/api/health');
                    // An older Network (and a test stand-in) may not serve /api/health; the JWKS route it must serve
                    // is the dependency that matters to sign-in.
                    if (res.status === 404) res = await fetchOnce('/api/.well-known/jwks');
                    return res.ok ? true : `OpenVibe.Network answered ${res.status}`;
                },
            },
            {
                name: 'network_jwks',
                required: false,
                check: () => (keys && keys.loaded() ? true : 'Network signing key not loaded yet: sign-in is unavailable'),
            },
            { name: 'oauth_client', required: false, check: () => (config.oauth.clientSecret ? true : 'OV_OAUTH_CLIENT_SECRET unset: sign-in cannot complete') },
            { name: 'live', required: false, check: () => feed.probe() },
            { name: 'games', required: false, check: () => ride.probe() },
            {
                name: 'actor',
                required: false,
                check: async () => {
                    const res = await fetchImpl(`${config.actorInternalUrl}/api/v1/agents`, {
                        headers: { Accept: 'application/json' },
                        signal: AbortSignal.timeout(2000),
                    });
                    return res.status < 500 ? true : `OpenVibe.Actor answered ${res.status}`;
                },
            },
        ],
    });
}

module.exports = { createServiceReadiness };
