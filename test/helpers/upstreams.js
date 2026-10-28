'use strict';
/**
 * In-process stand-ins for OpenVibe.Live, OpenVibe.Games and OpenVibe.Actor, on one HTTP server. The boot helper
 * points OV_LIVE_INTERNAL_URL, OV_GAMES_INTERNAL_URL and OV_ACTOR_INTERNAL_URL at it.
 *
 * A test changes state.fail.<source> (an HTTP status) or state.delay.<source> (ms), state.gamesNotFound, or
 * state.actor.status, and reads state.requests / state.counts to see what the app called.
 */
const http = require('http');

const DEFAULT_STREAMS = [
    { id: 1, username: 'ada', display_name: 'Ada', title: 'Night drive through the city', viewer_count: 12, total_viewer_count: 12, thumbnail_url: 'https://openvibe.media/live/ada.jpg', started_at: '2026-10-28T10:00:00.000Z' },
    { id: 2, username: 'bo', display_name: 'Bo', title: 'Surf practice, all day', viewer_count: 38, total_viewer_count: 38, thumbnail_url: 'https://openvibe.media/live/bo.jpg', started_at: '2026-10-28T09:00:00.000Z' },
    { id: 3, username: 'cy', display_name: 'Cy', title: 'Chat picks the route', viewer_count: 5, total_viewer_count: 5, thumbnail_url: 'https://openvibe.media/live/cy.jpg', started_at: '2026-10-28T08:00:00.000Z' },
];
const DEFAULT_CLIPS = [
    { key: 'clip:101', id: 101, href: '/clip/101', title: 'Kickflip over the pier', created_at: '2026-10-28T09:00:00.000Z', channel: { username: 'ada', display_name: 'Ada', avatar_url: null }, thumbnail_url: 'https://openvibe.media/clips/101.jpg', preview_url: 'https://openvibe.media/c/101/master.m3u8', duration_seconds: 31, ai_label: null },
    { key: 'clip:102', id: 102, href: '/clip/102', title: 'The long way down', created_at: '2026-10-28T07:00:00.000Z', channel: { username: 'bo', display_name: 'Bo', avatar_url: null }, thumbnail_url: 'https://openvibe.media/clips/102.jpg', preview_url: 'https://openvibe.media/c/102/master.m3u8', duration_seconds: 44, ai_label: null },
];
const DEFAULT_MOMENTS = [
    { key: 'clip:201', id: 201, href: 'https://openvibe.video/c/201', title: 'The wave that ate the camera', created_at: '2026-10-28T10:00:00.000Z', channel: { username: 'mira', display_name: 'Mira', avatar_url: null }, thumbnail_url: 'https://openvibe.media/clips/201.jpg', preview_url: 'https://openvibe.media/c/201/master.m3u8', duration_seconds: 18, ai_label: 'Auto-clip' },
];
const DEFAULT_MAPS = [
    { id: 'surf_lagoon', name: 'Surf Lagoon', tier: 1, stages: 3, author: 'OpenVibe', records: 5, wrMs: 61234, wrHolder: 'ada' },
    { id: 'surf_canyon', name: 'Surf Canyon', tier: 2, stages: 4, author: 'OpenVibe', records: 2, wrMs: 73456, wrHolder: 'bo' },
    { id: 'surf_orbit', name: 'Surf Orbit', tier: 4, stages: 6, author: 'OpenVibe', records: 0, wrMs: null, wrHolder: null },
];
const DEFAULT_TOP = {
    surf_lagoon: [{ rank: 1, name: 'ada', timeMs: 61234, runId: null }, { rank: 2, name: 'bo', timeMs: 62345, runId: null }],
    surf_canyon: [{ rank: 1, name: 'bo', timeMs: 73456, runId: null }],
    surf_orbit: [],
};

function listen(handler) {
    return new Promise((resolve) => {
        const sockets = new Set();
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                const json = (status, obj, headers = {}) => {
                    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
                    res.end(JSON.stringify(obj));
                };
                Promise.resolve(handler(req, raw, json, res)).catch((err) => json(500, { error: String(err && err.message) }));
            });
        });
        server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            url: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
        }));
    });
}

async function startUpstreams() {
    const state = {
        streams: DEFAULT_STREAMS.map((s) => ({ ...s })),
        clips: DEFAULT_CLIPS.map((s) => ({ ...s })),
        moments: DEFAULT_MOMENTS.map((s) => ({ ...s })),
        clipsNext: null,
        momentsNext: null,
        maps: DEFAULT_MAPS.map((m) => ({ ...m })),
        top: JSON.parse(JSON.stringify(DEFAULT_TOP)),
        gamesNotFound: false,
        gamesStatus: null,
        fail: { streams: null, clips: null, moments: null },
        delay: { streams: 0, clips: 0, moments: 0 },
        actor: { status: 201, id: 'tsk_01J8SURFEXAMPLE00000000', problem: null },
        requests: [],
        counts: { streams: 0, clips: 0, moments: 0, maps: 0, map: 0, actor: 0 },
    };

    const srv = await listen(async (req, raw, json) => {
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        const entry = { method: req.method, path: p, query: Object.fromEntries(url.searchParams), headers: { ...req.headers }, body: raw };
        state.requests.push(entry);

        const fail = (name) => {
            if (!state.fail[name]) return false;
            json(state.fail[name], { error: 'upstream failed' });
            return true;
        };

        if (p === '/api/streams') {
            state.counts.streams++;
            if (state.delay.streams) await new Promise((r) => setTimeout(r, state.delay.streams));
            if (fail('streams')) return;
            return json(200, { streams: state.streams });
        }
        if (p === '/api/content/feed') {
            state.counts.clips++;
            if (state.delay.clips) await new Promise((r) => setTimeout(r, state.delay.clips));
            if (fail('clips')) return;
            return json(200, { feed: 'content', type: 'clips', sort: 'new', window: 'week', items: state.clips, next: state.clipsNext, sources: { clips: 'ok' }, partial: false });
        }
        if (p === '/api/content/moments') {
            state.counts.moments++;
            if (state.delay.moments) await new Promise((r) => setTimeout(r, state.delay.moments));
            if (fail('moments')) return;
            return json(200, { feed: 'moments', type: 'clips', sort: 'top', window: 'week', items: state.moments, next: state.momentsNext, sources: { aiclips: 'ok' }, partial: false });
        }
        if (p === '/api/surf/maps') {
            state.counts.maps++;
            if (state.gamesStatus) return json(state.gamesStatus, { error: 'games failed' });
            if (state.gamesNotFound) return json(404, { error: 'not_found' });
            return json(200, { maps: state.maps });
        }
        const one = /^\/api\/surf\/maps\/([^/]+)$/.exec(p);
        if (one) {
            state.counts.map++;
            if (state.gamesStatus) return json(state.gamesStatus, { error: 'games failed' });
            if (state.gamesNotFound) return json(404, { error: 'not_found' });
            const id = decodeURIComponent(one[1]);
            const map = state.maps.find((m) => m.id === id);
            if (!map) return json(404, { error: 'unknown_map' });
            return json(200, { map, top: state.top[id] || [] });
        }
        if (p === '/api/v1/agents' && req.method === 'GET') return json(200, { agents: [] });
        if (p === '/api/v1/tasks' && req.method === 'POST') {
            state.counts.actor++;
            if (state.actor.status >= 400) {
                return json(state.actor.status, state.actor.problem || { type: 'about:blank', title: 'Refused', status: state.actor.status, code: 'actor.refused', detail: 'OpenVibe.Actor refused this task.' });
            }
            return json(state.actor.status, { id: state.actor.id, state: 'queued', task: 'the task' });
        }
        return json(404, { error: 'not found' });
    });

    return {
        url: srv.url,
        state,
        close: srv.close,
        resetCounts() { for (const k of Object.keys(state.counts)) state.counts[k] = 0; },
        requestsFor(path) { return state.requests.filter((r) => r.path === path); },
        lastFor(path) { return state.requests.filter((r) => r.path === path).pop() || null; },
    };
}

module.exports = { startUpstreams, DEFAULT_STREAMS, DEFAULT_CLIPS, DEFAULT_MOMENTS, DEFAULT_MAPS, DEFAULT_TOP };
