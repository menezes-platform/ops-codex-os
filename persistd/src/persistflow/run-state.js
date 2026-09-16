function asGeneration(value) {
  const generation = Number(value ?? 1);
  if (!Number.isInteger(generation) || generation < 1) {
    throw new Error('INVALID_GENERATION');
  }
  return generation;
}

function createRunState(input = {}) {
  const runId = String(input.runId || '').trim();
  if (!runId) throw new Error('RUN_ID_REQUIRED');
  return {
    ...input,
    runId,
    generation: asGeneration(input.generation),
    status: input.status || 'ACTIVE',
    successor: input.successor ?? null,
  };
}

function assertMutableGeneration(state, generation) {
  if (Number(generation) !== Number(state.generation)) {
    throw new Error('STALE_GENERATION');
  }
  return true;
}

function prepareSuccessor(state, candidate = {}) {
  if (state.successor) throw new Error('SUCCESSOR_ALREADY_PENDING');
  const expected = Number(state.generation) + 1;
  const generation = asGeneration(candidate.generation);
  if (generation !== expected) throw new Error('INVALID_SUCCESSOR_GENERATION');
  return {
    ...state,
    successor: {
      ...candidate,
      generation,
      status: candidate.status || 'PREPARED',
    },
  };
}

module.exports = { createRunState, assertMutableGeneration, prepareSuccessor };
