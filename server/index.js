'use strict';

/**
 * OpenVibe.Surf — process entry. `node server/index.js` listens on PORT (5110) behind nginx (deploy/).
 * Stateless: the HTTP server and the JWKS refresher are what stop.
 */
const { createApp } = require('./app');
const { gracefulStop } = require('openvibe-sdk/service');

/**
 * The process stop (openvibe-sdk/service): stop taking connections, drain the requests in flight, stop the JWKS
 * refresher, exit. Exported so a test can inject `exit` and `signals: false`.
 */
function createLifecycle({ server, ctx, exit, signals } = {}) {
    return gracefulStop({
        name: 'OpenVibe.Surf',
        server,
        deadlineExitCode: 0,
        exit,
        signals,
        deadlineMs: 10_000,
        close: [() => ctx.keys.client.stop()],
    });
}

async function start() {
    const { app, ctx } = await createApp();
    const { config } = ctx;
    const server = app.listen(config.port, config.host, () => {
        console.log(`[OpenVibe.Surf] ${config.nodeEnv} on http://${config.host}:${config.port} → ${config.baseUrl} (network ${config.networkUrl}, live ${config.liveInternalUrl}, games ${config.gamesInternalUrl}, actor ${config.actorInternalUrl})`);
        // Load the Network's signing key now, not on the first sign-in, so /api/ready reports sign-in as it is.
        ctx.keys.ensure().catch(() => {});
    });
    server.keepAliveTimeout = 65_000;
    createLifecycle({ server, ctx });
    return { server, ctx };
}

if (require.main === module) {
    start().catch((err) => {
        console.error('[OpenVibe.Surf] failed to start:', err);
        process.exit(1);
    });
}

module.exports = { start, createLifecycle };
