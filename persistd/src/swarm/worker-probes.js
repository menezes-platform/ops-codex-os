'use strict';

/**
 * Worker status classification enum
 */
const WorkerStatus = Object.freeze({
  IDLE: 'IDLE',
  STALE: 'STALE',
  BLOCKED: 'BLOCKED',
  OFFLINE: 'OFFLINE',
  DONE: 'DONE',
  ERROR: 'ERROR',
  WORKING: 'WORKING',
});

/**
 * Default timeout thresholds in milliseconds
 */
const DEFAULT_TIMEOUTS = Object.freeze({
  FRESHNESS_TIMEOUT_MS: 30000,
  HEARTBEAT_TIMEOUT_MS: 30000,
  GENERATION_STALL_MS: 30000,
});

/**
 * Normalizes worker type identifiers to canonical strings.
 *
 * @param {string} rawType
 * @returns {string}
 */
function normalizeWorkerType(rawType) {
  if (!rawType || typeof rawType !== 'string') return 'generic';
  const type = rawType.trim().toLowerCase();
  if (type === 'chatgpt-browser' || type === 'chatgpt' || type === 'chatgpt_browser') return 'chatgpt-browser';
  if (type === 'openclaw/myclawn' || type === 'openclaw' || type === 'myclawn' || type === 'myclaw' || type === 'openclaw_myclawn') return 'openclaw/myclawn';
  if (type === 'antigravity/agy' || type === 'antigravity' || type === 'agy' || type === 'antigravity_agy') return 'antigravity/agy';
  if (type === 'opencode' || type === 'opencode-interpreter' || type === 'opencode_interpreter') return 'opencode';
  if (type === 'headless-browser/agent-browser' || type === 'agent-browser' || type === 'headless-browser' || type === 'agent_browser' || type === 'headless_browser') return 'headless-browser/agent-browser';
  if (type === 'omniroute/control-plane' || type === 'omniroute' || type === 'control-plane' || type === 'omniroute_control_plane') return 'omniroute/control-plane';
  if (type === 'remote-device' || type === 'remote_device' || type === 'device' || type === 'mobile-device') return 'remote-device';
  return type;
}

/**
 * Parses a date or timestamp value to epoch milliseconds.
 *
 * @param {*} val
 * @returns {number|null}
 */
function parseTimestamp(val) {
  if (!val) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const parsed = Date.parse(String(val));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Safely extracts numerical tool invocation count from diverse snapshot shapes.
 *
 * @param {object} snapshot
 * @returns {number|null}
 */
function extractToolCount(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const candidates = [
    snapshot.toolCount,
    snapshot.toolCallsCount,
    snapshot.tool_count,
    snapshot.toolsInvoked,
    snapshot.metrics?.toolCount,
    snapshot.metrics?.toolCalls,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

/**
 * Safely extracts output size / string length from diverse snapshot shapes.
 *
 * @param {object} snapshot
 * @returns {number|null}
 */
function extractOutputSize(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (typeof snapshot.outputLength === 'number') return snapshot.outputLength;
  if (typeof snapshot.outputSize === 'number') return snapshot.outputSize;
  if (typeof snapshot.tokensGenerated === 'number') return snapshot.tokensGenerated;
  if (typeof snapshot.responseText === 'string') return snapshot.responseText.length;
  if (typeof snapshot.output === 'string') return snapshot.output.length;
  if (typeof snapshot.stdout === 'string') return snapshot.stdout.length;
  return null;
}

/**
 * Helper to detect freshness and changes between previous and current observations.
 * A worker is only progressing if there is concrete evidence of change or fresh events within timeout.
 *
 * @param {object} current
 * @param {object|null} previous
 * @param {object} [options]
 * @returns {object}
 */
function detectFreshness(current, previous = null, options = {}) {
  const timeoutMs = options.timeoutMs || current.freshnessTimeoutMs || current.timeoutMs || DEFAULT_TIMEOUTS.FRESHNESS_TIMEOUT_MS;
  const now = options.now != null
    ? (typeof options.now === 'number' ? options.now : parseTimestamp(options.now))
    : (parseTimestamp(current.observedAt) || Date.now());

  const currentProgressAt = parseTimestamp(
    current.lastProgressAt ||
    current.lastOutputAt ||
    current.lastEventAt ||
    current.lastHeartbeatAt ||
    current.updatedAt ||
    current.lastCommitAt
  );

  const previousProgressAt = previous ? parseTimestamp(
    previous.lastProgressAt ||
    previous.lastOutputAt ||
    previous.lastEventAt ||
    previous.lastHeartbeatAt ||
    previous.updatedAt ||
    previous.lastCommitAt
  ) : null;

  const currentToolCount = extractToolCount(current);
  const previousToolCount = previous ? extractToolCount(previous) : null;
  const toolCountChanged = currentToolCount !== null && previousToolCount !== null
    ? currentToolCount !== previousToolCount
    : false;
  const toolCountIncreased = currentToolCount !== null && previousToolCount !== null
    ? currentToolCount > previousToolCount
    : false;
  const toolDelta = currentToolCount !== null && previousToolCount !== null
    ? (currentToolCount - previousToolCount)
    : 0;

  const currentOutputSize = extractOutputSize(current);
  const previousOutputSize = previous ? extractOutputSize(previous) : null;
  const outputSizeChanged = currentOutputSize !== null && previousOutputSize !== null
    ? currentOutputSize !== previousOutputSize
    : false;
  const outputDelta = currentOutputSize !== null && previousOutputSize !== null
    ? (currentOutputSize - previousOutputSize)
    : 0;

  const progressTimestampAdvanced = Boolean(
    currentProgressAt && previousProgressAt && currentProgressAt > previousProgressAt
  );

  const taskStepAdvanced = Boolean(
    typeof current.currentStep === 'number' &&
    typeof previous?.currentStep === 'number' &&
    current.currentStep > previous.currentStep
  );

  const commitAdvanced = Boolean(
    typeof current.commitCount === 'number' &&
    typeof previous?.commitCount === 'number' &&
    current.commitCount > previous.commitCount
  );

  const hasChanged = toolCountChanged || outputSizeChanged || progressTimestampAdvanced || taskStepAdvanced || commitAdvanced;

  let elapsedSinceProgressMs = null;
  if (currentProgressAt != null) {
    elapsedSinceProgressMs = Math.max(0, now - currentProgressAt);
  }

  let elapsedBetweenObservationsMs = null;
  if (previous && previous.observedAt && current.observedAt) {
    const prevObs = parseTimestamp(previous.observedAt);
    const currObs = parseTimestamp(current.observedAt);
    if (prevObs && currObs) {
      elapsedBetweenObservationsMs = Math.max(0, currObs - prevObs);
    }
  }

  // Explicit stall or timeout flags in snapshot
  const isStallReported = Boolean(current.stalled || current.timedOut || current.idleTimeoutReached);

  let isFresh = false;
  const reasons = [];

  if (hasChanged) {
    isFresh = true;
    if (toolCountIncreased) reasons.push(`tool_count_advanced:${toolDelta}`);
    if (outputDelta > 0) reasons.push(`output_size_advanced:${outputDelta}`);
    if (progressTimestampAdvanced) reasons.push('progress_timestamp_advanced');
    if (taskStepAdvanced) reasons.push('task_step_advanced');
    if (commitAdvanced) reasons.push('commit_count_advanced');
  } else if (isStallReported) {
    isFresh = false;
    reasons.push('explicit_stall_reported');
  } else if (elapsedSinceProgressMs !== null) {
    if (elapsedSinceProgressMs <= timeoutMs) {
      isFresh = true;
      reasons.push(`fresh_timestamp_within_window:${elapsedSinceProgressMs}ms<=${timeoutMs}ms`);
    } else {
      isFresh = false;
      reasons.push(`timestamp_expired:${elapsedSinceProgressMs}ms>${timeoutMs}ms`);
    }
  } else if (previous && elapsedBetweenObservationsMs !== null) {
    if (elapsedBetweenObservationsMs >= timeoutMs) {
      isFresh = false;
      reasons.push(`no_change_over_timeout:${elapsedBetweenObservationsMs}ms>=${timeoutMs}ms`);
    } else {
      // Within grace period between snapshots with no changes yet
      isFresh = !isStallReported;
      reasons.push(`within_observation_window:${elapsedBetweenObservationsMs}ms<${timeoutMs}ms`);
    }
  } else {
    // Single observation without prior baseline
    const ageFromObserved = current.observedAt ? (now - parseTimestamp(current.observedAt)) : 0;
    if (ageFromObserved > timeoutMs) {
      isFresh = false;
      reasons.push(`observed_at_stale:${ageFromObserved}ms>${timeoutMs}ms`);
    } else {
      isFresh = !isStallReported;
      reasons.push('single_observation_baseline');
    }
  }

  return {
    isFresh,
    hasChanged,
    toolCountChanged,
    toolCountIncreased,
    toolDelta,
    outputSizeChanged,
    outputDelta,
    progressTimestampAdvanced,
    elapsedSinceProgressMs,
    elapsedBetweenObservationsMs,
    timeoutMs,
    reasons,
    evidence: {
      toolCount: currentToolCount,
      previousToolCount,
      toolDelta,
      outputSize: currentOutputSize,
      previousOutputSize,
      outputDelta,
      currentProgressAt,
      previousProgressAt,
      elapsedSinceProgressMs,
      elapsedBetweenObservationsMs,
      timeoutMs,
      isStallReported,
    },
  };
}

/**
 * Detects split-brain conditions where host/process state contradicts health endpoint / network authority.
 * e.g., service process or catalog is alive, but health endpoint reports DOWN/unhealthy.
 *
 * @param {object} snapshot
 * @returns {object}
 */
function detectSplitBrain(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { isSplitBrain: false, reason: null, details: {} };
  }

  const processAlive = Boolean(
    snapshot.processAlive === true ||
    (typeof snapshot.pid === 'number' && snapshot.pid > 0) ||
    snapshot.serviceAlive === true ||
    snapshot.running === true
  );

  const catalogLive = Boolean(
    snapshot.catalogLoaded === true ||
    snapshot.catalogLive === true ||
    (typeof snapshot.catalogCount === 'number' && snapshot.catalogCount > 0)
  );

  let healthDown = false;
  let healthError = null;

  if (snapshot.health !== undefined) {
    if (typeof snapshot.health === 'string') {
      const h = snapshot.health.trim().toUpperCase();
      if (h === 'DOWN' || h === 'UNHEALTHY' || h === 'CRITICAL' || h === 'ERROR') {
        healthDown = true;
        healthError = snapshot.health;
      }
    } else if (typeof snapshot.health === 'object' && snapshot.health !== null) {
      if (snapshot.health.ok === false) {
        healthDown = true;
        healthError = snapshot.health.error || snapshot.health.message || snapshot.health.status || 'health_check_failed';
      } else if (typeof snapshot.health.status === 'string') {
        const hs = snapshot.health.status.trim().toUpperCase();
        if (hs === 'DOWN' || hs === 'UNHEALTHY' || hs === 'ERROR') {
          healthDown = true;
          healthError = snapshot.health.error || snapshot.health.status;
        }
      }
    }
  }

  if (snapshot.healthOk === false) {
    healthDown = true;
    healthError = healthError || snapshot.healthError || 'healthOk_is_false';
  }

  if (typeof snapshot.healthStatus === 'string') {
    const hs = snapshot.healthStatus.trim().toUpperCase();
    if (hs === 'DOWN' || hs === 'UNHEALTHY' || hs === 'ERROR') {
      healthDown = true;
      healthError = healthError || snapshot.healthStatus;
    }
  }

  // Conflict 1: Process or catalog is live, but health probe is down
  if ((processAlive || catalogLive) && healthDown) {
    return {
      isSplitBrain: true,
      reason: 'SPLIT_BRAIN_PROCESS_ALIVE_HEALTH_DOWN',
      details: {
        processAlive,
        catalogLive,
        healthDown: true,
        healthError: healthError || 'Health endpoint reported down while process or catalog is active',
        pid: snapshot.pid || null,
        catalogCount: snapshot.catalogCount || null,
      },
    };
  }

  // Conflict 2: Process dead, but health claimed UP (false positive probe)
  const healthUp = snapshot.healthOk === true ||
    (typeof snapshot.health === 'object' && snapshot.health?.ok === true) ||
    (typeof snapshot.healthStatus === 'string' && snapshot.healthStatus.toUpperCase() === 'UP');
  if (snapshot.processAlive === false && healthUp) {
    return {
      isSplitBrain: true,
      reason: 'SPLIT_BRAIN_PROCESS_DEAD_HEALTH_UP',
      details: {
        processAlive: false,
        healthUp: true,
      },
    };
  }

  // Explicit splitBrain marker provided by caller/prober
  if (snapshot.splitBrain === true) {
    return {
      isSplitBrain: true,
      reason: snapshot.splitBrainReason || 'SPLIT_BRAIN_DETECTED',
      details: snapshot.splitBrainDetails || {},
    };
  }

  return { isSplitBrain: false, reason: null, details: {} };
}

/**
 * ChatGPT Browser Worker Adapter
 *
 * Current incident covered:
 * - ChatGPT stop button + timeout with no tool-count change => STALE
 */
function classifyChatGPTBrowser(current, previous, options) {
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: { splitBrain: true, details: splitBrain.details },
    };
  }

  // Check offline
  if (current.browserRunning === false || current.processAlive === false || current.windowOpen === false) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'CHATGPT_BROWSER_CLOSED_OR_OFFLINE',
      evidence: { browserRunning: current.browserRunning, windowOpen: current.windowOpen },
    };
  }

  // Check auth/challenge block
  if (
    current.loginRequired ||
    current.isLoggedIn === false ||
    current.authWall ||
    current.cloudflareChallenge ||
    current.turnstileBlocked ||
    current.captchaActive
  ) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'CHATGPT_AUTHENTICATION_OR_CHALLENGE_BLOCKED',
      evidence: {
        loginRequired: current.loginRequired,
        cloudflareChallenge: current.cloudflareChallenge,
        turnstileBlocked: current.turnstileBlocked,
        captchaActive: current.captchaActive,
      },
    };
  }

  // Check page error
  if (current.error || current.isErrorScreen || current.rateLimitExceeded || current.networkError) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'CHATGPT_ERROR_STATE',
      evidence: {
        error: current.error,
        isErrorScreen: current.isErrorScreen,
        rateLimitExceeded: current.rateLimitExceeded,
      },
    };
  }

  const isGenerating = Boolean(
    current.isGenerating === true ||
    current.stopButtonVisible === true ||
    current.state === 'generating'
  );

  const freshness = detectFreshness(current, previous, options);

  if (isGenerating) {
    // Incident: ChatGPT stop button + timeout with no tool-count change => STALE
    // If no progress evidence was observed and either timeout was reached or tool count stayed identical
    const noToolProgress = previous
      ? (freshness.toolDelta <= 0 && !freshness.outputSizeChanged && !freshness.progressTimestampAdvanced)
      : false;

    const timeoutReached = freshness.elapsedSinceProgressMs !== null
      ? freshness.elapsedSinceProgressMs >= freshness.timeoutMs
      : (freshness.elapsedBetweenObservationsMs !== null
        ? freshness.elapsedBetweenObservationsMs >= freshness.timeoutMs
        : Boolean(current.stalled || current.timedOut));

    if ((noToolProgress && timeoutReached) || (current.stopButtonVisible && timeoutReached && !freshness.hasChanged) || current.stalled) {
      return {
        status: WorkerStatus.STALE,
        reason: 'CHATGPT_STOP_BUTTON_TIMEOUT_NO_TOOL_PROGRESS',
        evidence: {
          stopButtonVisible: Boolean(current.stopButtonVisible),
          isGenerating: true,
          toolCount: extractToolCount(current),
          previousToolCount: previous ? extractToolCount(previous) : null,
          toolDelta: freshness.toolDelta,
          timeoutMs: freshness.timeoutMs,
          elapsedSinceProgressMs: freshness.elapsedSinceProgressMs,
          elapsedBetweenObservationsMs: freshness.elapsedBetweenObservationsMs,
          freshness: freshness.evidence,
        },
      };
    }

    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'CHATGPT_ACTIVE_GENERATION_WITH_PROGRESS',
        evidence: {
          stopButtonVisible: Boolean(current.stopButtonVisible),
          isGenerating: true,
          toolCount: extractToolCount(current),
          toolDelta: freshness.toolDelta,
          freshness: freshness.evidence,
        },
      };
    }

    return {
      status: WorkerStatus.STALE,
      reason: 'CHATGPT_GENERATION_STALLED',
      evidence: {
        stopButtonVisible: Boolean(current.stopButtonVisible),
        isGenerating: true,
        freshness: freshness.evidence,
      },
    };
  }

  // Not generating
  if (current.taskStatus === 'DONE' || current.completed === true) {
    return {
      status: WorkerStatus.DONE,
      reason: 'CHATGPT_CONVERSATION_TASK_DONE',
      evidence: { taskStatus: current.taskStatus, completed: current.completed },
    };
  }

  // Ready for prompt / idle
  return {
    status: WorkerStatus.IDLE,
    reason: 'CHATGPT_READY_IDLE',
    evidence: {
      promptReady: Boolean(current.promptReady || current.promptInput === '' || !current.stopButtonVisible),
      isGenerating: false,
    },
  };
}

/**
 * OpenClaw / MyClawn Worker Adapter
 *
 * Current incident covered:
 * - MyClawn authenticated blank prompt => IDLE
 */
function classifyMyClawn(current, previous, options) {
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: { splitBrain: true, details: splitBrain.details },
    };
  }

  if (current.connected === false || current.processAlive === false || current.socketAlive === false) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'MYCLAWN_DISCONNECTED_OR_OFFLINE',
      evidence: { connected: current.connected, processAlive: current.processAlive },
    };
  }

  if (current.authenticated === false || current.needsAuth === true || current.authRequired === true) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'MYCLAWN_AUTHENTICATION_REQUIRED',
      evidence: { authenticated: false, needsAuth: current.needsAuth },
    };
  }

  if (current.error || current.crashed) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'MYCLAWN_ERROR',
      evidence: { error: current.error },
    };
  }

  if (current.taskStatus === 'DONE' || current.lastTask?.status === 'DONE') {
    return {
      status: WorkerStatus.DONE,
      reason: 'MYCLAWN_TASK_COMPLETED',
      evidence: { taskStatus: current.taskStatus, lastTask: current.lastTask },
    };
  }

  const isExecuting = Boolean(
    current.isExecuting === true ||
    current.isBusy === true ||
    Boolean(current.activeTask) ||
    Boolean(current.currentTask)
  );

  if (isExecuting) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'MYCLAWN_EXECUTING_WITH_PROGRESS',
        evidence: {
          activeTask: current.activeTask || current.currentTask,
          toolDelta: freshness.toolDelta,
          freshness: freshness.evidence,
        },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'MYCLAWN_EXECUTION_STALLED',
      evidence: {
        activeTask: current.activeTask || current.currentTask,
        freshness: freshness.evidence,
      },
    };
  }

  // Incident: MyClawn authenticated blank prompt => IDLE
  const isBlankPrompt = current.promptInput === '' ||
    current.blankPrompt === true ||
    current.promptIsEmpty === true ||
    (typeof current.promptInput === 'string' && current.promptInput.trim().length === 0);

  const isAuthenticated = current.authenticated === true || current.hasActiveSession === true;

  if (isAuthenticated && isBlankPrompt) {
    return {
      status: WorkerStatus.IDLE,
      reason: 'MYCLAWN_AUTHENTICATED_BLANK_PROMPT',
      evidence: {
        authenticated: true,
        promptInput: current.promptInput,
        hasActiveSession: Boolean(current.hasActiveSession),
        isExecuting: false,
      },
    };
  }

  return {
    status: WorkerStatus.IDLE,
    reason: 'MYCLAWN_READY_IDLE',
    evidence: {
      authenticated: isAuthenticated,
      promptInput: current.promptInput,
      isExecuting: false,
    },
  };
}

/**
 * Antigravity / Agy Worker Adapter
 *
 * Required principle:
 * - A process being alive is NOT proof of work.
 *
 * Current incident covered:
 * - Antigravity last task DONE despite residual runner => DONE/IDLE not WORKING
 */
function classifyAntigravity(current, previous, options) {
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: { splitBrain: true, details: splitBrain.details },
    };
  }

  const isRunnerAlive = Boolean(
    current.processAlive === true ||
    current.runnerRunning === true ||
    current.cliRunning === true ||
    (typeof current.pid === 'number' && current.pid > 0)
  );

  if (!isRunnerAlive && current.taskStatus !== 'DONE' && current.status !== 'DONE') {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'ANTIGRAVITY_PROCESS_OFFLINE',
      evidence: { processAlive: false, runnerRunning: false },
    };
  }

  if (current.error || (typeof current.exitCode === 'number' && current.exitCode !== 0)) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'ANTIGRAVITY_RUNNER_ERROR',
      evidence: { error: current.error, exitCode: current.exitCode },
    };
  }

  // Incident: Antigravity last task DONE despite residual runner => DONE/IDLE not WORKING
  const lastTaskStatus = current.taskStatus || current.runStatus || current.lastTask?.status || current.status;
  const isLastTaskDone = lastTaskStatus === 'DONE' ||
    current.allTasksDone === true ||
    current.completed === true ||
    current.done === true;

  if (isLastTaskDone) {
    return {
      status: WorkerStatus.DONE,
      reason: 'ANTIGRAVITY_LAST_TASK_DONE_RESIDUAL_RUNNER',
      evidence: {
        taskStatus: 'DONE',
        lastTaskStatus: 'DONE',
        residualRunner: isRunnerAlive,
        isWorking: false,
        processAlive: current.processAlive,
        runnerRunning: current.runnerRunning,
      },
    };
  }

  if (current.waitingForUser || current.needsApproval || current.askQuestionPending || current.blocked === true) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'ANTIGRAVITY_WAITING_USER_APPROVAL',
      evidence: {
        waitingForUser: current.waitingForUser,
        needsApproval: current.needsApproval,
        askQuestionPending: current.askQuestionPending,
      },
    };
  }

  const hasActiveTask = Boolean(
    current.taskStatus === 'IN_PROGRESS' ||
    current.taskStatus === 'RUNNING' ||
    current.runStatus === 'IN_PROGRESS' ||
    Boolean(current.activeTask) ||
    (typeof current.activeSubagents === 'number' && current.activeSubagents > 0)
  );

  if (hasActiveTask) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'ANTIGRAVITY_TASK_PROGRESSING',
        evidence: {
          activeTask: current.activeTask,
          activeSubagents: current.activeSubagents,
          toolDelta: freshness.toolDelta,
          freshness: freshness.evidence,
        },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'ANTIGRAVITY_TASK_STALLED_NO_PROGRESS',
      evidence: {
        activeTask: current.activeTask,
        freshness: freshness.evidence,
      },
    };
  }

  // Residual runner alive with no tasks => IDLE, strictly not WORKING
  return {
    status: WorkerStatus.IDLE,
    reason: 'ANTIGRAVITY_RUNNER_IDLE',
    evidence: {
      processAlive: isRunnerAlive,
      hasActiveTask: false,
      isWorking: false,
    },
  };
}

/**
 * OpenCode Worker Adapter
 *
 * Current incident covered:
 * - OpenCode start screen/provider absent => BLOCKED or IDLE
 */
function classifyOpenCode(current, previous, options) {
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: { splitBrain: true, details: splitBrain.details },
    };
  }

  if (current.processAlive === false || current.running === false) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'OPENCODE_PROCESS_OFFLINE',
      evidence: { processAlive: false },
    };
  }

  if (current.error || current.crashed) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'OPENCODE_ERROR',
      evidence: { error: current.error },
    };
  }

  // Incident: OpenCode start screen/provider absent => BLOCKED or IDLE
  const isProviderAbsent = current.providerConfigured === false ||
    current.missingProvider === true ||
    current.providerAbsent === true ||
    (current.provider === null && current.atStartScreen === true) ||
    (current.provider === null && current.providerChecked === true);

  if (isProviderAbsent) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'OPENCODE_PROVIDER_ABSENT',
      evidence: {
        providerAbsent: true,
        providerConfigured: Boolean(current.providerConfigured),
        provider: current.provider || null,
        atStartScreen: Boolean(current.atStartScreen),
      },
    };
  }

  if (current.needsConfirmation || current.waitingForApproval || current.confirmationPromptVisible) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'OPENCODE_WAITING_USER_CONFIRMATION',
      evidence: { needsConfirmation: true },
    };
  }

  const isExecuting = Boolean(
    current.activeExecution === true ||
    current.isBusy === true ||
    Boolean(current.runningCell) ||
    Boolean(current.activeTask)
  );

  if (isExecuting) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'OPENCODE_EXECUTION_PROGRESSING',
        evidence: {
          activeExecution: true,
          toolDelta: freshness.toolDelta,
          freshness: freshness.evidence,
        },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'OPENCODE_EXECUTION_STALLED',
      evidence: {
        activeExecution: true,
        freshness: freshness.evidence,
      },
    };
  }

  if (current.taskStatus === 'DONE' || current.completed === true) {
    return {
      status: WorkerStatus.DONE,
      reason: 'OPENCODE_TASK_COMPLETED',
      evidence: { taskStatus: current.taskStatus },
    };
  }

  // OpenCode at start screen with provider configured => IDLE
  return {
    status: WorkerStatus.IDLE,
    reason: 'OPENCODE_START_SCREEN_READY',
    evidence: {
      atStartScreen: Boolean(current.atStartScreen),
      providerConfigured: current.providerConfigured !== false,
      provider: current.provider || 'default',
      isExecuting: false,
    },
  };
}

/**
 * Headless Browser / Agent Browser Worker Adapter
 *
 * Current incident covered:
 * - agent-browser newtab-only => IDLE
 */
function classifyAgentBrowser(current, previous, options) {
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: { splitBrain: true, details: splitBrain.details },
    };
  }

  if (current.browserRunning === false || current.processAlive === false || current.connected === false) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'AGENT_BROWSER_OFFLINE',
      evidence: { browserRunning: current.browserRunning, connected: current.connected },
    };
  }

  if (current.error || current.crashed || current.cdpDisconnected) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'AGENT_BROWSER_ERROR',
      evidence: { error: current.error, cdpDisconnected: current.cdpDisconnected },
    };
  }

  // Incident: agent-browser newtab-only => IDLE
  const tabs = Array.isArray(current.tabs) ? current.tabs : [];
  const activeTab = typeof current.activeTab === 'string' ? current.activeTab.trim() : '';

  const isNewTabOnly = current.newTabOnly === true ||
    (tabs.length === 1 && (tabs[0] === 'chrome://newtab/' || tabs[0] === 'chrome://newtab' || tabs[0] === 'about:blank')) ||
    (tabs.length === 0 && (activeTab === 'chrome://newtab/' || activeTab === 'chrome://newtab' || activeTab === 'about:blank')) ||
    (current.tabsCount === 1 && (activeTab === 'chrome://newtab/' || activeTab === 'chrome://newtab' || activeTab === 'about:blank'));

  if (isNewTabOnly && !current.navigating && !current.isEvaluating) {
    return {
      status: WorkerStatus.IDLE,
      reason: 'AGENT_BROWSER_NEWTAB_ONLY',
      evidence: {
        newTabOnly: true,
        tabs,
        activeTab,
        tabsCount: current.tabsCount || tabs.length,
        isEvaluating: false,
      },
    };
  }

  const isBusy = Boolean(
    current.navigating === true ||
    current.isEvaluating === true ||
    current.executingScript === true ||
    Boolean(current.activeTask)
  );

  if (isBusy) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'AGENT_BROWSER_ACTION_PROGRESSING',
        evidence: {
          navigating: current.navigating,
          isEvaluating: current.isEvaluating,
          freshness: freshness.evidence,
        },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'AGENT_BROWSER_ACTION_STALLED',
      evidence: {
        navigating: current.navigating,
        isEvaluating: current.isEvaluating,
        freshness: freshness.evidence,
      },
    };
  }

  if (current.taskStatus === 'DONE' || current.completed === true) {
    return {
      status: WorkerStatus.DONE,
      reason: 'AGENT_BROWSER_TASK_DONE',
      evidence: { taskStatus: current.taskStatus },
    };
  }

  return {
    status: WorkerStatus.IDLE,
    reason: 'AGENT_BROWSER_PAGE_IDLE',
    evidence: {
      tabs,
      activeTab,
      isEvaluating: false,
    },
  };
}

/**
 * OmniRoute / Control Plane Worker Adapter
 *
 * Current incident covered:
 * - OmniRoute process/catalog live but health says server down => ERROR/split-brain
 */
function classifyOmniRoute(current, previous, options) {
  // Incident: OmniRoute process/catalog live but health says server down => ERROR/split-brain
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: {
        splitBrain: true,
        ...splitBrain.details,
      },
    };
  }

  const isProcessAlive = Boolean(
    current.processAlive === true ||
    (typeof current.pid === 'number' && current.pid > 0) ||
    current.serviceAlive === true ||
    current.running === true
  );

  if (!isProcessAlive) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'OMNIROUTE_PROCESS_OFFLINE',
      evidence: { processAlive: false },
    };
  }

  // If health probe is explicitly failing without process conflict (handled above)
  const healthOk = current.healthOk !== false &&
    (current.health === undefined || (typeof current.health === 'object' && current.health?.ok !== false)) &&
    (typeof current.health !== 'string' || current.health.toUpperCase() !== 'DOWN');

  if (!healthOk || current.error) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'OMNIROUTE_HEALTH_DOWN',
      evidence: {
        health: current.health,
        healthOk: current.healthOk,
        error: current.error,
      },
    };
  }

  const activeRoutings = typeof current.activeRoutingCount === 'number'
    ? current.activeRoutingCount
    : (typeof current.requestsInFlight === 'number' ? current.requestsInFlight : 0);

  if (activeRoutings > 0) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'OMNIROUTE_ROUTING_ACTIVE',
        evidence: {
          activeRoutingCount: activeRoutings,
          freshness: freshness.evidence,
        },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'OMNIROUTE_ROUTING_STALLED',
      evidence: {
        activeRoutingCount: activeRoutings,
        freshness: freshness.evidence,
      },
    };
  }

  return {
    status: WorkerStatus.IDLE,
    reason: 'OMNIROUTE_LISTENING_IDLE',
    evidence: {
      processAlive: isProcessAlive,
      catalogLoaded: Boolean(current.catalogLoaded),
      catalogCount: current.catalogCount || 0,
      activeRoutingCount: 0,
    },
  };
}

/**
 * Remote Device Worker Adapter
 *
 * Current incident covered:
 * - remote device status offline => OFFLINE
 */
function classifyRemoteDevice(current, previous, options) {
  const statusStr = typeof current.status === 'string' ? current.status.trim().toLowerCase() : '';

  // Incident: remote device status offline => OFFLINE
  if (
    statusStr === 'offline' ||
    statusStr === 'disconnected' ||
    statusStr === 'unreachable' ||
    current.connected === false ||
    current.pingOk === false
  ) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'REMOTE_DEVICE_OFFLINE',
      evidence: {
        status: current.status || 'offline',
        connected: Boolean(current.connected),
        pingOk: current.pingOk !== false,
      },
    };
  }

  if (statusStr === 'error' || current.error || current.batteryCritical === true) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'REMOTE_DEVICE_ERROR',
      evidence: {
        status: current.status,
        error: current.error,
        batteryCritical: current.batteryCritical,
      },
    };
  }

  if (statusStr === 'locked' || current.deviceLocked === true || current.awaitingPermission === true) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'REMOTE_DEVICE_BLOCKED_OR_LOCKED',
      evidence: { deviceLocked: current.deviceLocked, awaitingPermission: current.awaitingPermission },
    };
  }

  if (current.taskStatus === 'DONE' || current.completed === true) {
    return {
      status: WorkerStatus.DONE,
      reason: 'REMOTE_DEVICE_TASK_DONE',
      evidence: { taskStatus: current.taskStatus },
    };
  }

  const hasActiveJob = Boolean(
    statusStr === 'busy' ||
    Boolean(current.currentRunId) ||
    Boolean(current.activeTask)
  );

  if (hasActiveJob) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'REMOTE_DEVICE_WORKING_WITH_FRESH_HEARTBEAT',
        evidence: {
          currentRunId: current.currentRunId,
          freshness: freshness.evidence,
        },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'REMOTE_DEVICE_HEARTBEAT_EXPIRED',
      evidence: {
        currentRunId: current.currentRunId,
        freshness: freshness.evidence,
      },
    };
  }

  return {
    status: WorkerStatus.IDLE,
    reason: 'REMOTE_DEVICE_CONNECTED_IDLE',
    evidence: {
      status: current.status || 'online',
      connected: true,
      hasActiveJob: false,
    },
  };
}

/**
 * Generic Worker Adapter
 */
function classifyGenericWorker(current, previous, options) {
  const splitBrain = detectSplitBrain(current);
  if (splitBrain.isSplitBrain) {
    return {
      status: WorkerStatus.ERROR,
      reason: splitBrain.reason,
      evidence: { splitBrain: true, details: splitBrain.details },
    };
  }

  if (current.processAlive === false || current.connected === false) {
    return {
      status: WorkerStatus.OFFLINE,
      reason: 'GENERIC_WORKER_OFFLINE',
      evidence: { processAlive: current.processAlive, connected: current.connected },
    };
  }

  if (current.error) {
    return {
      status: WorkerStatus.ERROR,
      reason: 'GENERIC_WORKER_ERROR',
      evidence: { error: current.error },
    };
  }

  if (current.blocked || current.waitingForUser || current.needsAuth) {
    return {
      status: WorkerStatus.BLOCKED,
      reason: 'GENERIC_WORKER_BLOCKED',
      evidence: { blocked: true },
    };
  }

  if (current.taskStatus === 'DONE' || current.status === 'DONE') {
    return {
      status: WorkerStatus.DONE,
      reason: 'GENERIC_WORKER_TASK_DONE',
      evidence: { taskStatus: 'DONE' },
    };
  }

  const isWorking = Boolean(current.isWorking || current.isBusy || current.activeTask);
  if (isWorking) {
    const freshness = detectFreshness(current, previous, options);
    if (freshness.isFresh) {
      return {
        status: WorkerStatus.WORKING,
        reason: 'GENERIC_WORKER_PROGRESSING',
        evidence: { freshness: freshness.evidence },
      };
    }
    return {
      status: WorkerStatus.STALE,
      reason: 'GENERIC_WORKER_STALLED',
      evidence: { freshness: freshness.evidence },
    };
  }

  return {
    status: WorkerStatus.IDLE,
    reason: 'GENERIC_WORKER_IDLE',
    evidence: { processAlive: true },
  };
}

/**
 * Primary entrypoint to classify an observable worker snapshot.
 *
 * Distinguishes: IDLE, STALE, BLOCKED, OFFLINE, DONE, ERROR, WORKING.
 * Returns: { workerId, workerType, status, reason, evidence, observedAt, splitBrain }
 *
 * @param {object} currentSnapshot
 * @param {object|null} [previousSnapshot=null]
 * @param {object} [options={}]
 * @returns {object}
 */
function classifyWorkerSnapshot(currentSnapshot, previousSnapshot = null, options = {}) {
  if (!currentSnapshot || typeof currentSnapshot !== 'object') {
    return {
      workerId: 'unknown',
      workerType: 'unknown',
      status: WorkerStatus.ERROR,
      reason: 'INVALID_SNAPSHOT_INPUT',
      evidence: { input: currentSnapshot },
      observedAt: new Date().toISOString(),
      splitBrain: false,
    };
  }

  const workerId = currentSnapshot.workerId || currentSnapshot.id || currentSnapshot.name || 'anonymous-worker';
  const rawType = currentSnapshot.workerType || currentSnapshot.type || currentSnapshot.role || 'generic';
  const workerType = normalizeWorkerType(rawType);

  const observedAt = currentSnapshot.observedAt
    ? (typeof currentSnapshot.observedAt === 'string' ? currentSnapshot.observedAt : new Date(currentSnapshot.observedAt).toISOString())
    : (options.now ? new Date(options.now).toISOString() : new Date().toISOString());

  let classification;
  switch (workerType) {
    case 'chatgpt-browser':
      classification = classifyChatGPTBrowser(currentSnapshot, previousSnapshot, options);
      break;
    case 'openclaw/myclawn':
      classification = classifyMyClawn(currentSnapshot, previousSnapshot, options);
      break;
    case 'antigravity/agy':
      classification = classifyAntigravity(currentSnapshot, previousSnapshot, options);
      break;
    case 'opencode':
      classification = classifyOpenCode(currentSnapshot, previousSnapshot, options);
      break;
    case 'headless-browser/agent-browser':
      classification = classifyAgentBrowser(currentSnapshot, previousSnapshot, options);
      break;
    case 'omniroute/control-plane':
      classification = classifyOmniRoute(currentSnapshot, previousSnapshot, options);
      break;
    case 'remote-device':
      classification = classifyRemoteDevice(currentSnapshot, previousSnapshot, options);
      break;
    default:
      classification = classifyGenericWorker(currentSnapshot, previousSnapshot, options);
      break;
  }

  const splitBrainFlag = Boolean(
    classification.evidence?.splitBrain ||
    classification.reason?.startsWith('SPLIT_BRAIN')
  );

  return {
    workerId,
    workerType,
    status: classification.status,
    reason: classification.reason,
    evidence: classification.evidence || {},
    observedAt,
    splitBrain: splitBrainFlag,
  };
}

/**
 * Batch probe classification helper.
 *
 * @param {Array<object>|Record<string, object>} snapshots
 * @param {Record<string, object>|null} [previousSnapshots={}]
 * @param {object} [options={}]
 * @returns {Array<object>|Record<string, object>}
 */
function probeWorkers(snapshots, previousSnapshots = {}, options = {}) {
  if (Array.isArray(snapshots)) {
    return snapshots.map((s) => {
      const prev = previousSnapshots?.[s.workerId || s.id] || null;
      return classifyWorkerSnapshot(s, prev, options);
    });
  }

  if (snapshots && typeof snapshots === 'object') {
    const results = {};
    for (const [id, snap] of Object.entries(snapshots)) {
      const prev = previousSnapshots?.[id] || null;
      results[id] = classifyWorkerSnapshot(snap, prev, options);
    }
    return results;
  }

  return [];
}

module.exports = {
  WorkerStatus,
  DEFAULT_TIMEOUTS,
  normalizeWorkerType,
  parseTimestamp,
  extractToolCount,
  extractOutputSize,
  detectFreshness,
  detectSplitBrain,
  classifyChatGPTBrowser,
  classifyMyClawn,
  classifyAntigravity,
  classifyOpenCode,
  classifyAgentBrowser,
  classifyOmniRoute,
  classifyRemoteDevice,
  classifyGenericWorker,
  classifyWorkerSnapshot,
  probeWorkers,
};
