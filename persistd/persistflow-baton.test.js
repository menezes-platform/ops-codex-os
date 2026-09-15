const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveToolProfile } = require('./src/persistflow/capabilities');
const { buildBatonV2 } = require('./src/persistflow/baton-v2');
const { buildSuccessorMessage } = require('./src/handoff');

test('resolves only tools required by the current task', () => {
  const manifest = {
    machine: 'Remote Desktop Commander',
    sourceControl: 'GitHub',
    research: 'Exa',
    memory: 'Engram',
    hosting: 'Vercel',
    database: 'Supabase',
  };
  const profile = resolveToolProfile(manifest, ['machine', 'sourceControl', 'research']);
  assert.deepEqual(profile.required, [
    'PersistFlow', 'Remote Desktop Commander', 'GitHub', 'Exa',
  ]);
  assert.equal(profile.required.includes('Vercel'), false);
  assert.equal(profile.required.includes('Supabase'), false);
  assert.equal(profile.required.includes('Engram'), false);
});

test('Baton v2 carries durable task state, autonomy and minimal tools', () => {
  const state = {
    RUN_ID: 'demo', CLAIM_NONCE: 'nonce-8', OBJECTIVE: 'finish DoD',
    DOD_REF: 'docs/dod.md', CURRENT_STATE: 'tests green',
    NEXT_SAFE_ACTION: 'implement policy', PROJECT_ROOT: 'C:/demo',
    BRANCH: 'feat/demo', HEAD: 'abc123', DEVICE_ID: 'machine-1',
    AUTONOMY_PRESET: 'POST_BRAINSTORM',
    CAPABILITY_MANIFEST_JSON: JSON.stringify({ machine: 'Remote Desktop Commander', research: 'Exa', hosting: 'Vercel' }),
    TOOL_NEEDS_JSON: JSON.stringify(['machine', 'research']),
  };
  const baton = buildBatonV2(state, 8);
  assert.equal(baton.version, 2);
  assert.equal(baton.authority.generation, 8);
  assert.equal(baton.state.nextSafeAction, 'implement policy');
  assert.equal(baton.autonomy.preset, 'POST_BRAINSTORM');
  assert.deepEqual(baton.tools.required, ['PersistFlow', 'Remote Desktop Commander', 'Exa']);
  assert.equal(baton.tools.required.includes('Vercel'), false);

  const message = buildSuccessorMessage(state, 8);
  const line = message.split('\n').find((item) => item.startsWith('BATON_V2_JSON: '));
  assert.ok(line);
  assert.equal(JSON.parse(line.slice('BATON_V2_JSON: '.length)).version, 2);
  assert.match(message, /CLAIM_NONCE: nonce-8/);
});
