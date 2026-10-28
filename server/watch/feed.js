'use strict';

/**
 * The Watch feed: OpenVibe.Live's three surfaces merged into one list.
 *
 *   GET /api/v1/watch/feed?topic=all|live|clips|moments&cursor=
 *
 * Sources (all on OV_LIVE_INTERNAL_URL):
 *   live     GET /api/streams                                  → { streams: [...] }
 *            GET /api/vods/stream/:id/live, /api/vods/:vod/live-info → dvr_hls: a stream that records to MP4 (RTMP,
 *            OBS) plays in the TV over Media's growing DVR playlist, a little behind the live edge; any other stream
 *            (a browser's WHIP stream, a private recording, a slow answer) keeps its link to the channel
 *   clips    GET /api/content/feed?type=clips&sort=new…        → { items: [...], next }
 *   moments  GET /api/content/moments?type=clips&sort=top…     → { items: [...], next }
 *
 * One shape for every card:
 *   { key, kind, title, channel: { username, display_name, avatar_url }, thumbnail,
 *     play: { type: 'live'|'hls', src, page }, duration_seconds, viewers, why }
 *
 * Live streams come first, by viewers. Clips and moments then interleave by freshness. Finally no two cards from
 * the same channel sit next to each other when another channel is available. The merged page is cached 30 s;
 * every Live source is given 2 s and a source that fails is left out and named in `sources`.
 */
const DEFAULT_TOPIC = 'all';
const TOPICS = ['all', 'live', 'clips', 'moments'];
const SOURCE_NAMES = ['live', 'clips', 'moments'];
const LIVE_DVR_MAX = 6;
const CLIP_PATH = '/api/content/feed';
const MOMENT_PATH = '/api/content/moments';

class WatchError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const clean = (v, max = 140) => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!max || s.length <= max) return s;
    return `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const fresh = (item) => {
    const n = Date.parse(String(item && item.created_at || ''));
    return Number.isFinite(n) ? n : 0;
};

/** An absolute http(s) URL, or null. Media is the only place cards point for pictures and playlists. */
function mediaUrl(v) {
    if (typeof v !== 'string' || !v) return null;
    try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch { return null; }
}

/** A card's page: on OpenVibe.Live, or on openvibe.video where Live's clips and moments open now. */
const VIDEO_ORIGINS = new Set(['https://openvibe.video']);
function livePage(livePublicUrl, href) {
    if (typeof href !== 'string' || !href) return null;
    try {
        const base = new URL(`${livePublicUrl}/`);
        const u = new URL(href, base);
        return u.origin === base.origin || VIDEO_ORIGINS.has(u.origin) ? u.toString() : null;
    } catch { return null; }
}

function channelOf(c) {
    if (typeof c === 'string' && c) c = { username: c, display_name: c };
    const ch = c && typeof c === 'object' ? c : {};
    const username = typeof ch.username === 'string' && ch.username ? ch.username.slice(0, 64) : null;
    return {
        username,
        display_name: clean(ch.display_name || username || 'Unknown channel', 80) || 'Unknown channel',
        avatar_url: /^https:\/\/[^\s"'<>]{1,500}$/.test(String(ch.avatar_url || '')) ? String(ch.avatar_url) : null,
    };
}

function idOf(item, kind) {
    if (item && (typeof item.id === 'string' || typeof item.id === 'number')) return String(item.id);
    if (item && typeof item.key === 'string' && item.key) return item.key.includes(':') ? item.key.slice(item.key.indexOf(':') + 1) : item.key;
    return null;
}

function sortLive(items) {
    return [...items].sort((a, b) => (b.viewers - a.viewers) || String(a.channel.username || '').localeCompare(String(b.channel.username || '')));
}
function sortFresh(items) {
    return [...items].sort((a, b) => fresh(b) - fresh(a));
}

/**
 * Moments and clips interleaved by freshness: the freshest overall goes first, then the other kind, then back,
 * each side keeping its own newest-first order. When one side runs out the rest of the other follows.
 */
function interleave(moments, clips) {
    const a = sortFresh(moments);
    const b = sortFresh(clips);
    const out = [];
    while (a.length || b.length) {
        let takeMoment;
        if (!a.length) takeMoment = false;
        else if (!b.length) takeMoment = true;
        else if (!out.length) takeMoment = fresh(a[0]) >= fresh(b[0]);
        else takeMoment = out[out.length - 1].kind !== 'moment';
        out.push(takeMoment ? a.shift() : b.shift());
    }
    return out;
}

/**
 * Never two cards from the same channel in a row when another channel is available: when the next card repeats
 * the previous channel, pull the nearest later card from a different channel forward. Order otherwise stands.
 */
function separateChannels(items) {
    const pool = [...items];
    const out = [];
    while (pool.length) {
        let at = 0;
        const prev = out[out.length - 1];
        if (prev && prev.channel.username && pool[0].channel.username === prev.channel.username) {
            const other = pool.findIndex((it) => it.channel.username !== prev.channel.username);
            if (other > 0) at = other;
        }
        out.push(pool.splice(at, 1)[0]);
    }
    return out;
}

function rank(source, topic) {
    if (topic === 'live') return separateChannels(sortLive(source.live));
    if (topic === 'clips') return separateChannels(sortFresh(source.clips));
    if (topic === 'moments') return separateChannels(sortFresh(source.moments));
    // Live stays first, always: separate channels within the live block and within the content block, then fix
    // only the boundary between the two by pulling a content card from another channel forward.
    const live = separateChannels(sortLive(source.live));
    let content = separateChannels(interleave(source.moments, source.clips));
    if (live.length && content.length) {
        const prev = live[live.length - 1];
        if (prev.channel.username && content[0].channel.username === prev.channel.username) {
            const other = content.findIndex((it) => it.channel.username !== prev.channel.username);
            if (other > 0) {
                content.unshift(content.splice(other, 1)[0]);
                content = separateChannels(content);
            }
        }
    }
    return [...live, ...content];
}

const encodeCursor = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function decodeCursor(raw) {
    if (!raw) return {};
    let parsed = null;
    try { parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8')); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new WatchError(400, 'watch.invalid_cursor', 'That cursor is not one this feed made.');
    const out = {};
    if (typeof parsed.clips === 'string' && parsed.clips) out.clips = parsed.clips;
    if (typeof parsed.moments === 'string' && parsed.moments) out.moments = parsed.moments;
    return out;
}

function sourcesOf(topic) {
    if (topic === 'all') return [...SOURCE_NAMES];
    return [topic];
}

function createWatchFeed({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const cache = new Map();
    const ttl = config.watchCacheMs == null ? 30_000 : config.watchCacheMs;
    const sourceTimeout = config.watchSourceTimeoutMs || 2000;

    async function getJson(path) {
        let res;
        try {
            res = await fetchImpl(`${config.liveInternalUrl}${path}`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(sourceTimeout),
            });
        } catch (err) {
            const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
            throw Object.assign(new Error(timedOut ? 'OpenVibe.Live timed out' : 'OpenVibe.Live did not answer'), { source: timedOut ? 'timeout' : 'error' });
        }
        if (!res.ok) throw Object.assign(new Error(`OpenVibe.Live answered ${res.status}`), { source: 'error' });
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        if (!data || typeof data !== 'object') throw Object.assign(new Error('OpenVibe.Live answered without JSON'), { source: 'error' });
        return data;
    }

    /** The live stream's DVR playlist on Media, or null (never an error: the card then links to the channel). */
    async function dvrOf(streamId) {
        if (!Number.isSafeInteger(streamId) || streamId <= 0) return null;
        try {
            const live = await getJson(`/api/vods/stream/${streamId}/live`);
            const vodId = Number(live && live.vod && live.vod.id);
            if (!Number.isSafeInteger(vodId) || vodId <= 0) return null;
            const info = await getJson(`/api/vods/${vodId}/live-info`);
            return mediaUrl(info && info.dvr_hls);
        } catch { return null; }
    }

    async function loadLive() {
        const data = await getJson('/api/streams');
        const streams = (Array.isArray(data.streams) ? data.streams : []).filter((s) => s && typeof s.username === 'string' && s.username);
        const items = streams.map((s) => {
            const viewers = num(s.total_viewer_count != null ? s.total_viewer_count : (s.viewer_count != null ? s.viewer_count : s.viewers));
            return {
                key: `live:${s.username}`,
                kind: 'live',
                title: clean(s.title, 140) || 'Live now',
                channel: channelOf({ username: s.username, display_name: s.display_name, avatar_url: s.avatar_url }),
                thumbnail: mediaUrl(s.thumbnail_url || s.thumbnail),
                play: { type: 'live', src: null, page: livePage(config.livePublicUrl, `/@${encodeURIComponent(s.username)}`) },
                duration_seconds: numOrNull(s.duration_seconds),
                viewers,
                why: `Live now · ${viewers} watching`,
                created_at: s.started_at || null,
            };
        });
        // The busiest LIVE_DVR_MAX streams are asked for their playlist, side by side (each call has the source timeout).
        const busiest = items.map((it, i) => [it, Number(streams[i].id)]).sort((a, b) => b[0].viewers - a[0].viewers).slice(0, LIVE_DVR_MAX);
        await Promise.all(busiest.map(async ([it, id]) => {
            const src = await dvrOf(id);
            if (src) { it.play = { type: 'hls', src, page: it.play.page }; it.why = `${it.why} · a little behind live`; }
        }));
        return { items, next: null };
    }

    async function loadContent(kind, path, query, cursor) {
        const sourcePath = cursor
            ? `${path}?${new URLSearchParams({ ...query, cursor }).toString()}`
            : `${path}?${new URLSearchParams(query).toString()}`;
        const data = await getJson(sourcePath);
        const rows = Array.isArray(data.items) ? data.items : [];
        const items = [];
        for (const it of rows) {
            if (!it || typeof it !== 'object') continue;
            const id = idOf(it, kind);
            const src = mediaUrl(it.preview_url);
            const page = livePage(config.livePublicUrl, it.href);
            if (!id || !src || !page) continue;   // a card without a playable preview is not a Watch card
            items.push({
                key: `${kind}:${id}`,
                kind,
                title: clean(it.title, 140) || (kind === 'clip' ? 'Clip' : 'Moment'),
                channel: channelOf(it.channel),
                thumbnail: mediaUrl(it.thumbnail_url || it.thumbnail),
                play: { type: 'hls', src, page },
                duration_seconds: numOrNull(it.duration_seconds),
                viewers: null,
                why: kind === 'clip' ? 'New clip' : 'Top AI moment this week',
                created_at: it.created_at || null,
            });
        }
        return { items, next: typeof data.next === 'string' && data.next ? data.next : null };
    }

    /**
     * One merged page. `cursor` is this feed's opaque cursor (it carries each Live source's cursor). A bad cursor
     * or topic is a WatchError; a failing source never is — it is left out and named.
     */
    async function feed(topic = DEFAULT_TOPIC, cursorRaw = null) {
        const name = String(topic || DEFAULT_TOPIC);
        if (!TOPICS.includes(name)) throw new WatchError(400, 'watch.invalid_topic', 'topic must be all, live, clips or moments.');
        const cursor = decodeCursor(cursorRaw);
        const key = `${name}|${cursorRaw || ''}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < ttl) return hit.value;

        const wanted = sourcesOf(name);
        const includeLive = wanted.includes('live') && !(name === 'all' && cursorRaw);
        const jobs = [];
        const status = {};
        const value = { live: [], clips: [], moments: [] };
        const nexts = { clips: null, moments: null };

        if (includeLive) jobs.push(loadLive().then((out) => { value.live = out.items; status.live = 'ok'; }, (err) => { status.live = (err && err.source) || 'error'; log.warn('[OpenVibe.Surf] watch live source failed:', (err && err.message) || err); }));
        else if (wanted.includes('live')) status.live = 'ok';
        if (wanted.includes('clips')) jobs.push(loadContent('clip', CLIP_PATH, { type: 'clips', sort: 'new', window: 'week' }, cursor.clips)
            .then((out) => { value.clips = out.items; nexts.clips = out.next; status.clips = 'ok'; }, (err) => { status.clips = (err && err.source) || 'error'; log.warn('[OpenVibe.Surf] watch clips source failed:', (err && err.message) || err); }));
        if (wanted.includes('moments')) jobs.push(loadContent('moment', MOMENT_PATH, { type: 'clips', sort: 'top', window: 'week' }, cursor.moments)
            .then((out) => { value.moments = out.items; nexts.moments = out.next; status.moments = 'ok'; }, (err) => { status.moments = (err && err.source) || 'error'; log.warn('[OpenVibe.Surf] watch moments source failed:', (err && err.message) || err); }));

        await Promise.all(jobs);

        const failed = Object.keys(status).filter((k) => status[k] !== 'ok');
        // Paging is per Live source; a failed source has no next page until it answers again.
        const nextParts = {};
        if (nexts.clips) nextParts.clips = nexts.clips;
        if (nexts.moments) nextParts.moments = nexts.moments;
        const result = {
            topic: name,
            items: rank(value, name).map(({ created_at, ...card }) => card),
            next: Object.keys(nextParts).length ? encodeCursor(nextParts) : null,
            sources: status,
            partial: failed.length > 0,
        };
        // A partial page is not kept: the next request should ask the missing source again. A complete page is
        // cached for the whole 30 s.
        if (!failed.length) {
            cache.set(key, { at: now(), value: result });
            if (cache.size > 100) cache.delete(cache.keys().next().value);
        }
        return result;
    }

    /** Readiness: is Live answering at all? Any 2xx counts; 404 is a service that is not Live. */
    async function probe() {
        try {
            const res = await fetchImpl(`${config.liveInternalUrl}/api/streams`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(sourceTimeout),
            });
            return res.ok ? true : `OpenVibe.Live answered ${res.status}`;
        } catch (err) {
            return err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'OpenVibe.Live timed out' : 'OpenVibe.Live did not answer';
        }
    }

    function clear() { cache.clear(); }

    return { feed, probe, clear, get cached() { return cache; } };
}

module.exports = {
    createWatchFeed, WatchError, TOPICS, SOURCE_NAMES,
    // Exported for the tests that pin the ordering rules.
    interleave, separateChannels, sortLive, sortFresh, decodeCursor, encodeCursor,
};
