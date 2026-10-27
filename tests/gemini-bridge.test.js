const { test } = require('node:test');
const assert = require('node:assert/strict');

let bridge;
async function load() {
  bridge ??= await import('../skills/gemini-bridge/bin/gemini-bridge.mjs');
  return bridge;
}

test('delegation accepts eight independent workers but rejects nine', async () => {
  const { normalizeRequest } = await load();
  const make = n => ({workers: Array.from({length:n}, (_, i) => ({label:`w${i}`, task:`Task ${i}`}))});
  assert.equal(normalizeRequest(make(8)).workers.length, 8);
  assert.throws(() => normalizeRequest(make(9)), /1 to 8/);
});

test('readonly Gemini work defaults to bounded concurrency and plan mode', async () => {
  const { normalizeRequest, buildArgs } = await load();
  const request = normalizeRequest({workers:[{label:'review', task:'Review diff'}]});
  assert.equal(request.concurrency, 2);
  assert.equal(request.workers[0].mode, 'plan');
  const args = buildArgs(request.workers[0]);
  assert.deepEqual(args.slice(0, 2), ['--print', 'Review diff']);
  assert.ok(args.includes('gemini-4-argon-medium'));
  assert.ok(args.includes('json'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('mutating work requires an explicitly isolated worktree', async () => {
  const { normalizeRequest } = await load();
  assert.throws(() => normalizeRequest({workers:[{task:'Implement',mode:'accept-edits'}]}), /isolated worktree/i);
  assert.throws(() => normalizeRequest({workers:[{task:'Implement',mode:'unsafe'}]}), /mode/);
});

test('mutating workers cannot share a worktree', async () => {
  const { normalizeRequest } = await load();
  const workdir = process.cwd();
  assert.throws(() => normalizeRequest({workers:[
    {task:'Build A',mode:'accept-edits',workdir},
    {task:'Build B',mode:'accept-edits',workdir}
  ]}), /same worktree/i);
});

test('worker output projects response and token usage, not a raw transcript', async () => {
  const { projectResult } = await load();
  const output = projectResult({status:'SUCCESS',response:'PONG',conversation_id:'abc',usage:{total_tokens:12},duration_seconds:3});
  assert.deepEqual(output, {ok:true,response:'PONG',conversationId:'abc',totalTokens:12,durationSeconds:3});
});

test('delegation enforces the configured parallel bound', async () => {
  const { runDelegation, normalizeRequest } = await load();
  let active = 0;
  let peak = 0;
  const request = normalizeRequest({concurrency:2,workers:Array.from({length:5},(_,i)=>({task:`Task ${i}`}))});
  const result = await runDelegation(request, async (_worker) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return {ok:true,response:'done'};
  });
  assert.equal(peak, 2);
  assert.equal(result.length, 5);
  assert.ok(result.every(x => x.ok));
});
