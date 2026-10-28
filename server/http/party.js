'use strict';

/**
 * Watch together: the party page, its SSE stream and the host's commands.
 *
 *   POST /watch/party                  signed in, this site only → 303 /watch/p/<unguessable id> (JSON: 201)
 *   GET  /watch/p/:id                  signed in; joins once and renders the TV with the party bar
 *   GET  /watch/p/:id/events           SSE: `state` once, then `command` / `members` / `chat`; 15 s keepalive
 *   POST /watch/p/:id/command          host only, this site only: { channel_key, position_s, playing, at }
 *   POST /watch/p/:id/leave            anyone in the party; the last one out starts the 30-minute TTL
 *   POST /watch/p/:id/chat             host only: a validated https://openvibe.chat/... room URL (no chat here)
 *
 * State is in memory (watch/party.js): a restart ends every party; no database, no Events.
 */
const express = require('express');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { ownOrigin } = require('./api');
const { send } = require('../render/layout');
const { PartyError } = require('../watch/party');
const views = require('../views');

const jsonBody = express.json({ limit: '16kb' });
const formBody = express.urlencoded({ extended: false, limit: '8kb' });
const noStore = (res) => res.set('Cache-Control', 'private, no-store');

function prefersJson(req) {
    const accept = String(req.get('accept') || '');
    const type = String(req.get('content-type') || '');
    return accept.includes('application/json') || type.includes('application/json') || String(req.query.format || '') === 'json';
}

/**
 * A write made with the session cookie is this site's own: Sec-Fetch-Site same-origin, else an Origin equal to ours.
 * A request carrying neither is refused too (an old browser, or a client riding someone's cookie), as everywhere else.
 */
function crossSite(req, origin) {
    const site = String(req.get('sec-fetch-site') || '');
    if (site) return site !== 'same-origin';
    const sent = String(req.get('origin') || '');
    return !sent || !origin || sent !== origin;
}

function createPartyRoutes(ctx) {
    const { parties, feed, config, log } = ctx;
    const r = asyncRouter();
    const origin = ownOrigin(config);

    const problem = (req, res, status, code, detail) => {
        noStore(res);
        return http.sendProblem(res, status, code, { detail, ctx: req.ov });
    };
    const signedIn = (req) => req.viewer && req.viewer.kind === 'user';
    const isJson = (req) => prefersJson(req);

    function fail(req, res, err) {
        if (err instanceof PartyError) return problem(req, res, err.status, err.code, err.message);
        log.warn('[OpenVibe.Surf] watch party failed:', (err && err.message) || err);
        return problem(req, res, 500, 'party.error', 'The party hit a problem. Try again in a moment.');
    }

    // ── Open a party ────────────────────────────────────────
    r.post('/watch/party', jsonBody, formBody, async (req, res) => {
        noStore(res);
        if (crossSite(req, origin)) return problem(req, res, 403, 'party.cross_site', 'A party starts from openvibe.surf itself.');
        if (!signedIn(req)) {
            if (isJson(req)) return problem(req, res, 401, 'party.signin', 'Sign in at openvibe.surf to watch together.');
            return res.redirect(303, '/auth/login?next=%2Fwatch');
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        // Start on what is playing now, unless the person asked for a channel (the Watch page can pass one).
        let channelKey = body.channel_key == null ? null : body.channel_key;
        if (!channelKey) {
            try {
                const out = await feed.feed('all', null);
                channelKey = out && out.items && out.items[0] ? out.items[0].key : null;
            } catch (err) {
                log.warn('[OpenVibe.Surf] watch party start channel failed:', (err && err.message) || err);
            }
        }
        try {
            const opts = { host: req.viewer, channelKey, positionS: body.position_s, playing: body.playing, chatUrl: body.chat_url };
            if (body.at != null) opts.at = body.at;
            const party = parties.create(opts);
            const url = `/watch/p/${party.id}`;
            res.set('Location', url);
            if (isJson(req)) return res.status(201).json({ id: party.id, url, events_url: `${url}/events`, party: parties.snapshot(party) });
            return res.redirect(303, url);
        } catch (err) {
            return fail(req, res, err);
        }
    });

    // ── The party page (joining happens here; the SSE stream only serves members) ──
    r.get('/watch/p/:id', async (req, res) => {
        noStore(res);
        const party = parties.get(req.params.id);
        if (!party) return send(res, 404, views.notFound({ party: true }), { viewer: req.viewer });
        if (!signedIn(req)) {
            return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/watch/p/${party.id}`)}`);
        }
        const had = party.members.size;
        try {
            parties.join(party, req.viewer);
        } catch (err) {
            if (err instanceof PartyError) return res.status(err.status).type('text/plain').send(err.message);
            throw err;
        }
        if (party.members.size > had) broadcastMembers(party);
        let out = null;
        try {
            out = await feed.feed('all', null);
        } catch (err) {
            log.warn('[OpenVibe.Surf] watch party page feed failed:', (err && err.message) || err);
        }
        const state = parties.snapshot(party);
        return send(res, 200, views.party({
            feed: out,
            party: state,
            selectedKey: state.channel_key,
            isHost: parties.isHost(party, req.viewer),
            partyPath: `/watch/p/${party.id}`,
        }), { viewer: req.viewer });
    });

    // ── SSE: one initial state, then host commands and membership changes ──
    r.get('/watch/p/:id/events', (req, res) => {
        noStore(res);
        const party = parties.get(req.params.id);
        if (!party) return problem(req, res, 404, 'party.not_found', 'That watch party has ended.');
        if (!signedIn(req)) return problem(req, res, 401, 'party.signin', 'Sign in at openvibe.surf to join this party.');
        const member = parties.memberOf(party, req.viewer);
        if (!member) return problem(req, res, 403, 'party.join', 'Open the party page before joining its stream.');

        res.status(200).set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        res.setTimeout && res.setTimeout(0);
        parties.attach(party, res, member.key);

        const state = parties.snapshot(party);
        const write = (event, data) => {
            try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); return true; } catch { return false; }
        };
        res.write('retry: 3000\n\n');
        write('state', { ...state, is_host: parties.isHost(party, req.viewer), you: member.name });

        const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* the close handler removes it */ } }, 15_000);
        if (beat.unref) beat.unref();
        let done = false;
        const close = () => {
            if (done) return;
            done = true;
            clearInterval(beat);
            parties.detach(party, res);
        };
        req.on('close', close);
        res.on('close', close);
    });

    /** Send one SSE event to every stream of a party; a dead stream drops out. */
    function broadcast(party, event, data) {
        const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const stream of party.connections.keys()) {
            try { stream.write(line); } catch { party.connections.delete(stream); }
        }
    }

    /** Membership changes are personal only in `is_host`, so a promoted member learns it without a reload. */
    function broadcastMembers(party) {
        for (const [stream, key] of party.connections) {
            const data = { members: party.members.size, host: party.hostName, is_host: party.hostId === key };
            try { stream.write(`event: members\ndata: ${JSON.stringify(data)}\n\n`); } catch { party.connections.delete(stream); }
        }
    }

    // ── Host commands ───────────────────────────────────────
    // `/command` is the documented route; the bare party URL and `/state` are accepted aliases for older clients.
    const command = (req, res) => {
        noStore(res);
        if (crossSite(req, origin)) return problem(req, res, 403, 'party.cross_site', 'Host controls must come from openvibe.surf itself.');
        if (!signedIn(req)) return problem(req, res, 401, 'party.signin', 'Sign in at openvibe.surf to control this party.');
        const party = parties.get(req.params.id);
        if (!party) return problem(req, res, 404, 'party.not_found', 'That watch party has ended.');
        try {
            const next = parties.command(party, req.viewer, req.body || {});
            broadcast(party, 'command', next);
            return res.json({ ok: true, command: next });
        } catch (err) {
            return fail(req, res, err);
        }
    };
    r.post('/watch/p/:id/command', jsonBody, formBody, command);
    r.post('/watch/p/:id/state', jsonBody, formBody, command);
    r.post('/watch/p/:id', jsonBody, formBody, command);

    // ── Leave (the last member out starts the 30-minute clock) ──
    r.post('/watch/p/:id/leave', jsonBody, formBody, (req, res) => {
        noStore(res);
        if (crossSite(req, origin)) return problem(req, res, 403, 'party.cross_site', 'Leaving a party is a same-site action.');
        if (!signedIn(req)) {
            if (isJson(req)) return problem(req, res, 401, 'party.signin', 'Sign in at openvibe.surf to leave this party.');
            return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/watch/p/${req.params.id}`)}`);
        }
        const party = parties.get(req.params.id);
        if (!party) return problem(req, res, 404, 'party.not_found', 'That watch party has ended.');
        const out = parties.leave(party, req.viewer);
        if (out.left) broadcastMembers(party);
        if (isJson(req)) return res.json({ ok: true, ...out });
        return res.redirect(303, '/watch');
    });

    // ── The OpenVibe.Chat room link (a link only: there is no chat inside Surf) ──
    r.post('/watch/p/:id/chat', jsonBody, formBody, (req, res) => {
        noStore(res);
        if (crossSite(req, origin)) return problem(req, res, 403, 'party.cross_site', 'The chat link is set from openvibe.surf itself.');
        if (!signedIn(req)) return problem(req, res, 401, 'party.signin', 'Sign in at openvibe.surf to set the chat link.');
        const party = parties.get(req.params.id);
        if (!party) return problem(req, res, 404, 'party.not_found', 'That watch party has ended.');
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        try {
            const chatUrl = parties.setChat(party, req.viewer, body.chat_url == null ? body.url : body.chat_url);
            broadcast(party, 'chat', { chat_url: chatUrl });
            if (isJson(req)) return res.json({ ok: true, chat_url: chatUrl });
            return res.redirect(303, `/watch/p/${party.id}`);
        } catch (err) {
            return fail(req, res, err);
        }
    });

    return r;
}

module.exports = { createPartyRoutes, crossSite };
