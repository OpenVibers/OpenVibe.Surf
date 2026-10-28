'use strict';

/**
 * Surf with Vibe: ask OpenVibe.Actor to browse the web on a private desk.
 *
 * A task is created with the person's OWN Network access token from the httpOnly `surf_at` cookie as a Bearer.
 * Actor accepts a person's session token at POST /api/v1/tasks (server/http/principal.js); the task then belongs
 * to them (their allowance, their task list), not to OpenVibe.Surf. The token is only ever put in the
 * Authorization header of the request to the configured Actor origin, and is never logged or rendered.
 *
 * The task text is a short standing instruction plus the person's query: browse with its tools (search_web,
 * read_page, a desk if a page needs it), keep its sources, and finish with a cited report. The request carries an
 * Idempotency-Key (and Actor's body `idempotency_key`: the same value), so a retried form does not start a second
 * task.
 *
 * Actor's 4xx answer (401, 403, 429 allowance/budget, 422) is a refusal the person can read: its status and detail
 * pass through. A timeout or a 5xx is this service's 502.
 */
const crypto = require('crypto');

const MIN_QUERY = 3;
const MAX_QUERY = 500;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,128}$/;
const TASK_ID = /^tsk_[A-Za-z0-9]{8,64}$/;
const PREFIX = 'Surf the web for me with your tools. Use search_web to find pages, read_page to read them, and a desk when a page needs one. Keep every source you use and finish with a short report that cites each source.';

function validQuery(value) {
    if (typeof value !== 'string') return false;
    const q = value.trim();
    return q.length >= MIN_QUERY && q.length <= MAX_QUERY;
}

/** The instruction Actor receives: the standing browsing brief, then the person's words unchanged. */
function taskText(query) {
    return `${PREFIX}\n\n${String(query == null ? '' : query).trim()}`;
}

function newIdempotencyKey() {
    return `surf:web:${crypto.randomBytes(16).toString('hex')}`;
}

function createWeb({ config, fetchImpl = globalThis.fetch, log = console }) {
    const taskPath = (id) => `${config.actorInternalUrl}/api/v1/tasks/${encodeURIComponent(id)}`;
    const headers = (token) => ({ Accept: 'application/json', Authorization: `Bearer ${token}` });

    async function task({ token, id }) {
        if (!token) throw Object.assign(new Error('Sign in to see your task.'), { status: 401 });
        if (!TASK_ID.test(String(id || ''))) throw Object.assign(new Error('Task not found.'), { status: 404 });
        let res;
        try {
            res = await fetchImpl(taskPath(id), { headers: headers(token), signal: AbortSignal.timeout(config.actorTimeoutMs || 15_000) });
        } catch {
            throw Object.assign(new Error('OpenVibe.Actor did not answer.'), { status: 502 });
        }
        if (!res.ok) throw Object.assign(new Error(res.status === 404 || res.status === 403 ? 'Task not found.' : 'OpenVibe.Actor did not answer.'), { status: res.status === 401 ? 401 : res.status === 403 || res.status === 404 ? 404 : 502 });
        let data;
        try { data = await res.json(); } catch { /* invalid Actor response */ }
        if (!data || data.id !== id) throw Object.assign(new Error('OpenVibe.Actor sent an invalid task.'), { status: 502 });
        return data;
    }

    // Actor offers SSE. Proxy it server-side so the person's token stays in an httpOnly cookie and never enters JS.
    async function events({ token, id, after, res }) {
        if (!token) return res.status(401).end();
        if (!TASK_ID.test(String(id || ''))) return res.status(404).end();
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        let upstream;
        try {
            upstream = await fetchImpl(`${taskPath(id)}/events`, {
                headers: { ...headers(token), Accept: 'text/event-stream', ...(after && /^\d{1,12}$/.test(after) ? { 'Last-Event-ID': after } : {}) }, signal: controller.signal,
            });
            if (!upstream.ok || !upstream.body) return res.status(upstream.status === 401 ? 401 : upstream.status === 403 || upstream.status === 404 ? 404 : 502).end();
            res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' });
            for await (const chunk of upstream.body) {
                if (res.destroyed) break;
                res.write(chunk);
            }
            res.end();
        } catch (err) {
            if (!controller.signal.aborted) {
                log.warn('[OpenVibe.Surf] Actor event stream ended:', (err && err.message) || err);
                if (!res.headersSent) res.status(502);
                res.end();
            }
        }
    }
    /**
     * Create one task for the person whose token this is. Resolves { task_id, page } (Surf's task page) or throws
     * { status, code, detail, actor } — a 4xx from Actor keeps its status and detail.
     */
    async function createTask({ token, query, idempotencyKey = null } = {}) {
        if (!token) throw Object.assign(new Error('Sign in to surf the web.'), { status: 401, code: 'token.required' });
        if (!validQuery(query)) throw Object.assign(new Error('query must be 3 to 500 characters.'), { status: 400, code: 'web.invalid_query' });
        const key = IDEMPOTENCY.test(String(idempotencyKey || '')) ? String(idempotencyKey) : newIdempotencyKey();
        let res;
        try {
            res = await fetchImpl(`${config.actorInternalUrl}/api/v1/tasks`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'Idempotency-Key': key,
                },
                body: JSON.stringify({ task: taskText(query), idempotency_key: key }),
                signal: AbortSignal.timeout(config.actorTimeoutMs || 15_000),
            });
        } catch (err) {
            const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
            log.warn('[OpenVibe.Surf] Actor did not answer:', timedOut ? 'timeout' : ((err && err.message) || err));
            throw Object.assign(new Error('OpenVibe.Actor did not answer. Try again in a moment.'), { status: 502, code: 'actor.unavailable' });
        }
        const text = await res.text().catch(() => '');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!res.ok) {
            // Actor's problem is written for the person: carry its status and words through, never its body verbatim
            // (it may echo request detail; the detail is what a person can act on).
            const detail = String((data && (data.detail || data.title || data.error)) || text || `OpenVibe.Actor answered ${res.status}`).slice(0, 400);
            throw Object.assign(new Error(detail), {
                status: res.status >= 400 && res.status < 500 ? res.status : 502,
                code: (data && data.code) || 'actor.refused',
                detail,
                actor: data,
            });
        }
        const id = data && typeof data.id === 'string' ? data.id : null;
        if (!id) {
            log.warn('[OpenVibe.Surf] Actor answered without a task id');
            throw Object.assign(new Error('OpenVibe.Actor answered without a task id.'), { status: 502, code: 'actor.invalid_response' });
        }
        return { task_id: id, page: `/web/t/${encodeURIComponent(id)}` };
    }

    return { createTask, task, events, validQuery };
}

module.exports = { createWeb, taskText, validQuery, newIdempotencyKey, PREFIX, MIN_QUERY, MAX_QUERY, TASK_ID };
