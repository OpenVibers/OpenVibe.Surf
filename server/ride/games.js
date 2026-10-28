'use strict';

/**
 * Ride: the OpenVibe.Games surf map catalogue, proxied and cached for 60 s.
 *
 *   GET /api/v1/ride/maps        → { maps: [...], games: 'ready'|'not_ready' }
 *   GET /api/v1/ride/maps/:id    → { map, top, games: 'ready'|'not_ready' }
 *
 * Games is adding GET /api/surf/maps and GET /api/surf/maps/:id now. Until those routes exist Games answers 404:
 * that is "not ready", not an error, so the list is empty and the answer says so. A timeout or a 5xx is an
 * error (the caller answers 502); a failure is never cached, so the next request asks again.
 *
 * Every map carries `embed_url`: https://openvibe.games/play/surf?map=<id>&embed=1 (SURF_GAMES_PUBLIC_URL).
 */
const EMBED_PATH = '/play/surf';

function clean(id) {
    return String(id == null ? '' : id).trim().slice(0, 64);
}

function createRide({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const ttl = config.rideCacheMs == null ? 60_000 : config.rideCacheMs;
    let listCache = null;                    // { at, value }
    const mapCache = new Map();              // id -> { at, value }

    const publicUrl = String(config.gamesPublicUrl || 'https://openvibe.games').replace(/\/+$/, '');
    const embedUrl = (id) => `${publicUrl}${EMBED_PATH}?map=${encodeURIComponent(clean(id))}&embed=1`;

    function withEmbed(map) {
        if (!map || typeof map !== 'object') return map;
        const id = clean(map.id);
        return id ? { ...map, embed_url: embedUrl(id) } : map;
    }

    async function request(path) {
        let res;
        try {
            res = await fetchImpl(`${config.gamesInternalUrl}${path}`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(config.gamesTimeoutMs || 4000),
            });
        } catch (err) {
            const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
            throw Object.assign(new Error(timedOut ? 'OpenVibe.Games timed out' : 'OpenVibe.Games did not answer'), { status: 502, code: 'games.unavailable' });
        }
        const text = await res.text().catch(() => '');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        return { status: res.status, ok: res.ok, data, text };
    }

    function notReadyList() { return { maps: [], games: 'not_ready' }; }
    function notReadyMap(id) {
        return {
            map: { id: clean(id), name: null, tier: null, stages: null, author: null, records: null, wrMs: null, wrHolder: null, embed_url: embedUrl(id) },
            top: [],
            games: 'not_ready',
        };
    }

    /** The map catalogue, from memory while it is under 60 s old. A 404 from Games is a cached "not ready". */
    async function maps({ fresh = false } = {}) {
        if (!fresh && listCache && now() - listCache.at < ttl) return listCache.value;
        const r = await request('/api/surf/maps');
        if (r.status === 404) {
            const value = notReadyList();
            listCache = { at: now(), value };
            return value;
        }
        if (!r.ok || !r.data || !Array.isArray(r.data.maps)) {
            throw Object.assign(new Error(`OpenVibe.Games catalogue answered ${r.status}`), { status: 502, code: 'games.unavailable', response: r });
        }
        const value = { maps: r.data.maps.filter(Boolean).map(withEmbed), games: 'ready' };
        listCache = { at: now(), value };
        return value;
    }

    /** One map: Games' answer with the embed URL added, or a "not ready" shell that still carries the embed. */
    async function map(id, { fresh = false } = {}) {
        const key = clean(id);
        if (!key) throw Object.assign(new Error('a map id is required'), { status: 400, code: 'ride.invalid_map' });
        const hit = mapCache.get(key);
        if (!fresh && hit && now() - hit.at < ttl) return hit.value;
        const r = await request(`/api/surf/maps/${encodeURIComponent(key)}`);
        if (r.status === 404) {
            const value = notReadyMap(key);
            mapCache.set(key, { at: now(), value });
            if (mapCache.size > 200) mapCache.delete(mapCache.keys().next().value);
            return value;
        }
        if (!r.ok || !r.data || !r.data.map) {
            throw Object.assign(new Error(`OpenVibe.Games map answered ${r.status}`), { status: 502, code: 'games.unavailable', response: r });
        }
        const value = { map: withEmbed(r.data.map), top: Array.isArray(r.data.top) ? r.data.top : [], games: 'ready' };
        mapCache.set(key, { at: now(), value });
        if (mapCache.size > 200) mapCache.delete(mapCache.keys().next().value);
        return value;
    }

    /** Readiness: Games is reachable when it answers anything below 500. A 404 still means the process is up. */
    async function probe() {
        try {
            const res = await fetchImpl(`${config.gamesInternalUrl}/api/surf/maps`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(config.gamesTimeoutMs || 4000),
            });
            return res.status < 500 ? true : `OpenVibe.Games answered ${res.status}`;
        } catch (err) {
            return err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'OpenVibe.Games timed out' : 'OpenVibe.Games did not answer';
        }
    }

    function clear() { listCache = null; mapCache.clear(); }

    return { maps, map, probe, clear, embedUrl, get cached() { return listCache; } };
}

module.exports = { createRide, embedUrl: (config, id) => `${String(config.gamesPublicUrl || 'https://openvibe.games').replace(/\/+$/, '')}${EMBED_PATH}?map=${encodeURIComponent(clean(id))}&embed=1` };
