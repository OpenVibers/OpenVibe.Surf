'use strict';

/**
 * Watch together: parties held in this one process's memory (there is no database or Events bus).
 *
 * A signed-in person opens a party; the host's commands (channel, position, playing, at) are broadcast to every
 * member over SSE. The Map is bounded (200 parties, 50 members each) and an empty party is dropped 30 minutes
 * after its last member leaves; a process restart ends every party.
 *
 * This module holds state only. HTTP, SSE and the page live in http/party.js; the TV markup is views/index.js.
 */
const crypto = require('crypto');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_PARTIES = 200;
const MAX_MEMBERS = 50;
const ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_CHANNEL_KEY = 200;

class PartyError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const clean = (v, max = 200) => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) : s;
};
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number.isFinite(Number(v)) ? Number(v) : null));

/** The signed-in person behind a request: their Network subject when there is one, else their username. */
function personOf(viewer) {
    if (!viewer || viewer.kind !== 'user') throw new PartyError(401, 'party.signin', 'Sign in at openvibe.surf to watch together.');
    const key = viewer.subject || viewer.username;
    if (!key) throw new PartyError(401, 'party.signin', 'Sign in at openvibe.surf to watch together.');
    return {
        key: String(key),
        name: clean(viewer.displayName || viewer.username || 'A surfer', 80) || 'A surfer',
    };
}

/** A channel key as the Watch feed made it (`live:bo`, `clip:201`, `moment:7`). */
function channelKeyOf(v, { required = false } = {}) {
    if (v == null || v === '') {
        if (required) throw new PartyError(400, 'party.invalid_channel', 'channel_key is required.');
        return null;
    }
    const s = String(v).trim();
    if (!s || s.length > MAX_CHANNEL_KEY || /[\u0000-\u001f\u007f]/.test(s)) {
        throw new PartyError(400, 'party.invalid_channel', 'channel_key must be a Watch channel key.');
    }
    return s;
}

/** `{ channel_key, position_s, playing, at }` from a host POST, validated. */
function commandOf(body, fallbackAt) {
    const b = body && typeof body === 'object' ? body : {};
    const channel_key = channelKeyOf(b.channel_key, { required: true });
    const rawPosition = b.position_s == null ? 0 : finite(b.position_s);
    if (rawPosition == null || rawPosition < 0 || rawPosition > 7 * 24 * 60 * 60) {
        throw new PartyError(400, 'party.invalid_position', 'position_s must be a number of seconds from 0 to 604800.');
    }
    let playing = true;
    if (typeof b.playing === 'boolean') playing = b.playing;
    else if (b.playing === 'false' || b.playing === '0') playing = false;
    else if (b.playing != null && b.playing !== 'true' && b.playing !== '1') {
        throw new PartyError(400, 'party.invalid_playing', 'playing must be true or false.');
    }
    const rawAt = b.at == null ? fallbackAt : finite(b.at);
    if (rawAt == null || rawAt < 0) throw new PartyError(400, 'party.invalid_at', 'at must be a millisecond timestamp.');
    // Accept the host's clock when it is plausible; a wildly wrong clock would put every member years away.
    const at = Math.abs(rawAt - fallbackAt) > 5 * 60 * 1000 ? fallbackAt : rawAt;
    return { channel_key, position_s: rawPosition, playing, at };
}

/** Only an absolute https link on openvibe.chat; no credentials, no other host. */
function validChatUrl(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 500) return null;
    try {
        const u = new URL(value.trim());
        if (u.protocol !== 'https:' || u.hostname !== 'openvibe.chat') return null;
        if (u.username || u.password || (u.port && u.port !== '443')) return null;
        return u.toString();
    } catch { return null; }
}

function createParties({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, maxParties = MAX_PARTIES, maxMembers = MAX_MEMBERS } = {}) {
    const parties = new Map();
    const limitParties = Math.min(MAX_PARTIES, Math.max(1, maxParties));
    const limitMembers = Math.min(MAX_MEMBERS, Math.max(1, maxMembers));

    /** Drop empty parties whose 30 minutes are up. Every public read calls this first. */
    function prune() {
        const t = now();
        for (const [id, p] of parties) {
            if (p.members.size !== 0 || p.emptySince == null || t - p.emptySince < ttlMs) continue;
            // A member who left without closing their browser tab may still hold a stream: end it with the party.
            for (const stream of p.connections.keys()) { try { stream.end(); } catch { /* already gone */ } }
            p.connections.clear();
            parties.delete(id);
        }
    }

    function get(id) {
        prune();
        const key = String(id == null ? '' : id);
        return ID_RE.test(key) ? parties.get(key) || null : null;
    }

    function create({ host, channelKey = null, positionS = 0, playing = true, at = now(), chatUrl = null } = {}) {
        prune();
        if (parties.size >= limitParties) throw new PartyError(429, 'party.limit', 'Too many watch parties are open right now. Try again later.');
        const who = personOf(host);
        const t = now();
        let id;
        do { id = crypto.randomBytes(18).toString('base64url'); } while (parties.has(id));
        const member = { key: who.key, name: who.name, joinedAt: t };
        const startPos = finite(positionS);
        const startAt = finite(at);
        const party = {
            id,
            hostId: who.key,
            hostName: who.name,
            members: new Map([[who.key, member]]),
            state: {
                channel_key: channelKeyOf(channelKey),
                position_s: startPos == null || startPos < 0 ? 0 : startPos,
                playing: playing !== false,
                at: startAt == null ? t : startAt,
            },
            chatUrl: validChatUrl(chatUrl),
            createdAt: t,
            emptySince: null,
            // SSE responses → the member key that opened them (so a new host can be told it is host).
            connections: new Map(),
        };
        parties.set(id, party);
        return party;
    }

    function memberOf(party, viewer) {
        const who = personOf(viewer);
        return party.members.get(who.key) || null;
    }

    function join(party, viewer) {
        const who = personOf(viewer);
        const existing = party.members.get(who.key);
        if (existing) {
            existing.name = who.name;
            party.emptySince = null;
            return existing;
        }
        if (party.members.size >= limitMembers) throw new PartyError(429, 'party.full', `This party is full (${limitMembers} members).`);
        const member = { key: who.key, name: who.name, joinedAt: now() };
        party.members.set(who.key, member);
        // A party whose host left with nobody left has no host; the first person back is it.
        if (!party.hostId) { party.hostId = who.key; party.hostName = who.name; }
        party.emptySince = null;
        return member;
    }

    function leave(party, viewer) {
        const who = personOf(viewer);
        const left = party.members.delete(who.key);
        let hostChanged = false;
        if (left && party.hostId === who.key) {
            const next = [...party.members.values()].sort((a, b) => (a.joinedAt - b.joinedAt) || a.key.localeCompare(b.key))[0] || null;
            party.hostId = next ? next.key : null;
            party.hostName = next ? next.name : null;
            hostChanged = true;
        }
        if (party.members.size === 0 && party.emptySince == null) party.emptySince = now();
        return { left: Boolean(left), hostChanged, members: party.members.size };
    }

    function requireHost(party, viewer) {
        const who = personOf(viewer);
        if (party.hostId !== who.key) throw new PartyError(403, 'party.not_host', 'Only the host changes the channel and the position.');
        return who;
    }

    function command(party, viewer, body) {
        requireHost(party, viewer);
        const next = commandOf(body, now());
        party.state = next;
        return next;
    }

    function setChat(party, viewer, raw) {
        requireHost(party, viewer);
        const url = validChatUrl(raw);
        if (!url) throw new PartyError(400, 'party.invalid_chat', 'Paste a https://openvibe.chat/... link.');
        party.chatUrl = url;
        return url;
    }

    function isHost(party, viewer) {
        try { return party.hostId === personOf(viewer).key; } catch { return false; }
    }

    /** What the page and the SSE clients may see: no network subject ids, no tokens. */
    function snapshot(party) {
        return {
            id: party.id,
            host: party.hostName,
            members: party.members.size,
            chat_url: party.chatUrl,
            channel_key: party.state.channel_key,
            position_s: party.state.position_s,
            playing: party.state.playing,
            at: party.state.at,
            created_at: party.createdAt,
        };
    }

    function attach(party, res, memberKey) { party.connections.set(res, memberKey); }
    function detach(party, res) { party.connections.delete(res); }

    function sweep() { prune(); return parties.size; }
    function clear() { parties.clear(); }

    return {
        create, get, join, leave, command, setChat, isHost, memberOf, snapshot,
        attach, detach, sweep, clear,
        get size() { return parties.size; },
        get parties() { return parties; },
    };
}

module.exports = {
    createParties, PartyError, validChatUrl, channelKeyOf, commandOf,
    DEFAULT_TTL_MS, MAX_PARTIES, MAX_MEMBERS, ID_RE,
};
