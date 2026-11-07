'use strict';
/**
 * The agent's step (design 2026-11-07): OpenVibe.Surf tells the one timeline behind the Dock what the browsing task
 * it started for a person is doing. Surf keeps no database and no outbox — the task is OpenVibe.Actor's — so the
 * step is published straight to OpenVibe.Events with Surf's service token, best effort: Events being down never fails
 * the task. The payload is a generated title, an outcome and a link: never the person's query, a page, a source or
 * the report.
 */
const AGENT_TOPICS = Object.freeze({
    started: 'agent.step.started',
    updated: 'agent.step.updated',
    ended: 'agent.step.ended',
});
const USER_SUBJECT = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const STATUS_OF = Object.freeze({
    queued: 'waiting', running: 'running', verifying: 'running', needs_you: 'waiting',
    succeeded: 'done', failed: 'failed', cancelled: 'stopped',
});
const ENDED = new Set(['done', 'failed', 'stopped']);

/** One browsing task → the agent's step: a generated title, its state and its page. Never the query or a source. */
function agentStepOf(task, { status = null, baseUrl = 'https://openvibe.surf', startedAt = null, endedAt = null, costUsd = null, reason = null } = {}) {
    const state = STATUS_OF[status] || status || STATUS_OF[task.state] || 'running';
    const base = String(baseUrl || 'https://openvibe.surf').replace(/\/+$/, '');
    const cost = costUsd == null && task.cost ? Number(task.cost.usd) : costUsd;
    // The one Computer (plan 2026-11-07): the Dock's step reads the same object the task record carries, never a copy.
    const computer = task.computer && typeof task.computer === 'object' ? task.computer : null;
    return {
        step_id: String(task.id),
        mode: 'browse',
        product: 'surf',
        ref: String(task.id),
        title: 'Surfing the web for you',
        status: state,
        started_at: new Date(startedAt == null ? Date.now() : startedAt).toISOString(),
        ended_at: ENDED.has(state) ? new Date(endedAt == null ? Date.now() : endedAt).toISOString() : null,
        placement: { where: computer ? computer.machine : 'On a private desk', why: 'it browses for you, never with your accounts, and stops at logins and anything that would spend money' },
        ...(computer ? { computer } : {}),
        cost_usd: Number.isFinite(cost) && cost >= 0 ? cost : null,
        link: `${base}/web/t/${encodeURIComponent(String(task.id))}`,
        reason: state === 'failed' || state === 'stopped' ? (reason == null ? null : String(reason).slice(0, 240)) : null,
    };
}

/** The topic a state is: the step starts, moves on, or ends. */
function topicOf(state) {
    return state === 'waiting' || state === 'running' ? 'started' : 'ended';
}

/**
 * The publisher. `publish` may be passed in (tests, or a deployment with its own client); otherwise an
 * openvibe-sdk Events client with Surf's service token is made once. Without EVENTS_URL and a client secret, every
 * call is a quiet no-op.
 */
function createAgentSteps({ config = {}, publish = null, log = console, now = Date.now } = {}) {
    const enabled = Boolean(publish || (config.events && config.events.url && config.oauth && config.oauth.clientSecret));
    const sent = new Map();   // subject|task → the last state published, so a polled page is not a row every second
    let client = null;

    function eventsClient() {
        if (client) return client;
        const { createClient } = require('openvibe-sdk/core');
        const { createServiceTokenClient } = require('openvibe-sdk/auth');
        const { createEventsClient } = require('openvibe-sdk/events');
        const tokenProvider = createServiceTokenClient({
            tokenUrl: `${String(config.networkInternalUrl || 'http://127.0.0.1:4000').replace(/\/+$/, '')}/oauth/token`,
            clientId: config.oauth.clientId || 'surf', clientSecret: config.oauth.clientSecret,
            scope: { 'openvibe.events': 'events.event.publish' },
        });
        client = createEventsClient(createClient({ baseUrls: { events: config.events.url }, tokenProvider, retries: 0 }), { source: 'surf' });
        return client;
    }

    /**
     * Publish the task's step if its state is new for this person. `subject` is the person whose token ran the task.
     * Returns the envelope (or null); never throws.
     */
    async function note(task, { subject = null } = {}) {
        if (!enabled || !task || !String(task.id || '') || !USER_SUBJECT.test(String(subject || ''))) return null;
        const state = STATUS_OF[task.state] || null;
        if (!state) return null;
        const key = `${subject}|${task.id}`;
        if (sent.get(key) === state) return null;
        const envelope = {
            event_type: AGENT_TOPICS[topicOf(state)],
            actor: { type: 'user', id: subject },
            subject: { type: 'user', id: subject },
            visibility: 'internal',
            priority: ENDED.has(state) ? 'important' : 'low',
            timestamp: new Date(now()).toISOString(),
            payload: agentStepOf(task, {
                status: state, baseUrl: config.baseUrl, startedAt: task.created_at ? Date.parse(task.created_at) : now(), now,
                reason: state === 'failed' ? (task.error && (task.error.detail || task.error.code)) || 'it did not finish' : null,
            }),
        };
        sent.set(key, state);
        if (sent.size > 2000) sent.delete(sent.keys().next().value);
        try {
            if (publish) await publish(envelope);
            else await eventsClient().publish(envelope);
            return envelope;
        } catch (err) {
            sent.delete(key);   // the next read tries the same state again
            if (log && log.warn) log.warn('[OpenVibe.Surf] agent step:', err && err.message);
            return null;
        }
    }

    return { enabled, note, _sent: sent };
}

module.exports = { AGENT_TOPICS, agentStepOf, topicOf, createAgentSteps, STATUS_OF, USER_SUBJECT };
