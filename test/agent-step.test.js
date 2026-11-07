'use strict';
/**
 * The agent's step (design 2026-11-07): the browsing task Surf starts for a person is the Browse step of the one
 * timeline behind the Dock. Surf has no database and no outbox, so the step is published to OpenVibe.Events with
 * Surf's service token, best effort, once per state. The payload is a generated title, an outcome and a link: never
 * the person's query, a page it read, a source or the report.
 */
const assert = require('assert');
const { AGENT_TOPICS, agentStepOf, topicOf, createAgentSteps, STATUS_OF } = require('../server/web/agent-step');

const SUBJECT = 'usr_01JAB2C3D4E5F6G7H8J9K0MNPS';
const TASK = {
    id: 'tsk_01JAB2C3D4E5F6G7H8J9K0MNPS', state: 'running',
    task: 'find me a cheap flight to Lisbon, the person\'s own words',
    result: { answer: 'the report the agent wrote', sources: ['https://example.test/private-page'] },
    cost: { usd: 0.07 }, created_at: '2026-11-07T05:00:00.000Z',
};

assert.strictEqual(AGENT_TOPICS.started, 'agent.step.started');
assert.strictEqual(AGENT_TOPICS.ended, 'agent.step.ended');
assert.strictEqual(STATUS_OF.queued, 'waiting');
assert.strictEqual(STATUS_OF.verifying, 'running');
assert.strictEqual(topicOf('waiting'), 'started');
assert.strictEqual(topicOf('done'), 'ended');

const running = agentStepOf(TASK, { status: 'running', startedAt: Date.parse(TASK.created_at), baseUrl: 'https://openvibe.surf' });
assert.strictEqual(running.step_id, TASK.id);
assert.strictEqual(running.mode, 'browse');
assert.strictEqual(running.product, 'surf');
assert.strictEqual(running.status, 'running');
assert.strictEqual(running.title, 'Surfing the web for you');
assert.strictEqual(running.link, `https://openvibe.surf/web/t/${TASK.id}`);
assert.strictEqual(running.ended_at, null);
assert.strictEqual(running.cost_usd, 0.07);
assert.ok(running.placement && running.placement.where && running.placement.why);
const raw = JSON.stringify(running);
assert.ok(!raw.includes('cheap flight'), 'the query never travels');
assert.ok(!raw.includes('the report the agent wrote'), 'the report never travels');
assert.ok(!raw.includes('example.test/private-page'), 'a source never travels');
assert.ok(!('task' in running) && !('result' in running) && !('sources' in running), 'no field for the content');

const failed = agentStepOf({ ...TASK, state: 'failed', error: { detail: 'the site refused the desk' } }, { reason: 'the site refused the desk' });
assert.strictEqual(failed.status, 'failed');
assert.strictEqual(failed.reason, 'the site refused the desk');
assert.ok(failed.ended_at, 'an ended step says when it ended');

(async () => {
    const sent = [];
    const steps = createAgentSteps({
        config: { events: { url: 'http://events.test' }, oauth: { clientId: 'surf', clientSecret: 'x' }, baseUrl: 'https://openvibe.surf' },
        publish: async (env) => { sent.push(env); },
    });
    assert.strictEqual(steps.enabled, true);
    await steps.note(TASK, { subject: SUBJECT });
    await steps.note(TASK, { subject: SUBJECT });
    assert.strictEqual(sent.length, 1, 'one row per state, however often the page is read');
    assert.strictEqual(sent[0].event_type, 'agent.step.started');
    assert.deepStrictEqual(sent[0].subject, { type: 'user', id: SUBJECT });
    assert.strictEqual(sent[0].visibility, 'internal');
    await steps.note({ ...TASK, state: 'succeeded' }, { subject: SUBJECT });
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[1].event_type, 'agent.step.ended');
    assert.strictEqual(sent[1].payload.status, 'done');
    await steps.note(TASK, { subject: 'usr_nope' });
    assert.strictEqual(sent.length, 2, 'no person subject, no step');
    // Off (no EVENTS_URL or no client secret) is a quiet no-op, like every service whose relay is off.
    const off = createAgentSteps({ config: { events: { url: '' } } });
    assert.strictEqual(off.enabled, false);
    assert.strictEqual(await off.note(TASK, { subject: SUBJECT }), null);
    console.log('surf agent step: a generated title, an outcome and a link — never the query, a page or a source');
    console.log('all passed');
})().catch((err) => { console.error(err); process.exit(1); });
