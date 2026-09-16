function projectControlState(state, existing = {}) {
  return {
    ...existing,
    RUN_ID: state.runId,
    GENERATION: String(state.generation),
    STATUS: state.status || 'ACTIVE',
    CANONICAL_AUTHORITY: 'PERSISTFLOW',
    CLAIM_NONCE: '',
    SUCCESSOR_GENERATION: state.successor ? String(state.successor.generation) : '',
    SUCCESSOR_CHAT_ID: state.successor?.chatId || '',
    NEXT_SAFE_ACTION_JSON: JSON.stringify(state.nextSafeAction ?? null),
  };
}

module.exports = { projectControlState };
