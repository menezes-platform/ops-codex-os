function assertOutcome(value) {
  if (!value || typeof value !== 'object') throw new Error('EPHEMERAL_WORKER_OUTCOME_REQUIRED');
  if (!['completed', 'handoff'].includes(value.status)) throw new Error('EPHEMERAL_WORKER_OUTCOME_INVALID');
  return value;
}

function workerView(provider, worker) {
  if (provider && typeof provider.describe === 'function') return provider.describe(worker);
  return {
    id: String(worker?.id || ''),
    provider: String(worker?.provider || 'unknown'),
    buildExpiresAt: worker?.buildExpiresAt || null,
  };
}

class EphemeralWorkerLoop {
  constructor({
    provider,
    maxWorkers = 3,
    handoffLeadMs = 8 * 60_000,
    checkpoint = async () => {},
    clock = () => new Date(),
  } = {}) {
    if (!provider || typeof provider.acquire !== 'function') throw new Error('EPHEMERAL_PROVIDER_REQUIRED');
    if (typeof provider.release !== 'function') throw new Error('EPHEMERAL_PROVIDER_RELEASE_REQUIRED');
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1) throw new Error('EPHEMERAL_MAX_WORKERS_INVALID');
    if (!Number.isFinite(handoffLeadMs) || handoffLeadMs < 0) throw new Error('EPHEMERAL_HANDOFF_LEAD_INVALID');
    if (typeof checkpoint !== 'function') throw new Error('EPHEMERAL_CHECKPOINT_REQUIRED');
    this.provider = provider;
    this.maxWorkers = maxWorkers;
    this.handoffLeadMs = handoffLeadMs;
    this.checkpoint = checkpoint;
    this.clock = clock;
  }

  async emit(type, payload = {}) {
    await this.checkpoint({
      type,
      at: this.clock().toISOString(),
      ...payload,
    });
  }

  async run(job, {
    resume = null,
    executeWorker,
    finalizeHandoff = async () => {},
    checkpoint = this.checkpoint,
  } = {}) {
    if (!job || typeof job !== 'object') throw new Error('EPHEMERAL_JOB_REQUIRED');
    const jobId = String(job.id || job.taskId || '').trim();
    if (!jobId) throw new Error('EPHEMERAL_JOB_ID_REQUIRED');
    if (typeof executeWorker !== 'function') throw new Error('EPHEMERAL_EXECUTOR_REQUIRED');
    if (typeof finalizeHandoff !== 'function') throw new Error('EPHEMERAL_FINALIZER_REQUIRED');

    let attempt = 1;
    await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquire.started', { jobId, attempt, provider: 'railway-anonymous' });
    let current;
    try {
      current = await this.provider.acquire({ workerId: jobId + '-g' + attempt, job, attempt });
    } catch (error) {
      await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquire.failed', {
        jobId, attempt, provider: 'railway-anonymous', error: String(error?.message || error).slice(0, 160),
      });
      throw error;
    }
    await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquire.succeeded', { jobId, attempt, worker: workerView(this.provider, current) });
    await this.checkpointEvent(checkpoint, 'ephemeral.worker.ready', { jobId, attempt, worker: workerView(this.provider, current) });
    let currentResume = resume;
    await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquired', {
      jobId,
      attempt,
      worker: workerView(this.provider, current),
    });

    for (;;) {
      const deadlineMs = Date.parse(String(current.buildExpiresAt || ''));
      if (!Number.isFinite(deadlineMs)) throw new Error('EPHEMERAL_WORKER_DEADLINE_REQUIRED');
      const handoffAt = new Date(deadlineMs - this.handoffLeadMs).toISOString();

      let outcome;
      try {
        outcome = assertOutcome(await executeWorker({
          job,
          worker: current,
          attempt,
          resume: currentResume,
          handoffAt,
          hardDeadlineAt: new Date(deadlineMs).toISOString(),
        }));
      } catch (error) {
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.failed', {
          jobId,
          attempt,
          worker: workerView(this.provider, current),
          error: String(error?.message || error).slice(0, 240),
        });
        throw error;
      }

      if (outcome.status === 'completed') {
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.completed', {
          jobId,
          attempt,
          worker: workerView(this.provider, current),
          result: outcome.result ?? null,
        });
        await this.provider.release(current);
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.release', { jobId, attempt, worker: workerView(this.provider, current) });
        return {
          status: 'completed',
          attempts: attempt,
          result: outcome.result ?? null,
        };
      }

      await this.checkpointEvent(checkpoint, 'ephemeral.worker.handoff.requested', {
        jobId,
        attempt,
        worker: workerView(this.provider, current),
        resume: outcome.resume ?? null,
      });

      if (attempt >= this.maxWorkers) {
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.budget_exhausted', {
          jobId,
          attempt,
          worker: workerView(this.provider, current),
          resume: outcome.resume ?? null,
        });
        throw new Error('EPHEMERAL_WORKER_BUDGET_EXHAUSTED');
      }

      const nextAttempt = attempt + 1;
      let successor;
      await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquire.started', {
        jobId, attempt: nextAttempt, provider: 'railway-anonymous', predecessor: workerView(this.provider, current),
      });
      try {
        successor = await this.provider.acquire({
          workerId: jobId + '-g' + nextAttempt,
          job,
          attempt: nextAttempt,
          predecessor: current,
        });
      } catch (error) {
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquire.failed', {
          jobId, attempt: nextAttempt, provider: 'railway-anonymous', error: String(error?.message || error).slice(0, 160),
        });
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.successor_failed', {
          jobId,
          attempt,
          worker: workerView(this.provider, current),
          error: String(error?.message || error).slice(0, 240),
          resume: outcome.resume ?? null,
        });
        throw error;
      }

      await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquire.succeeded', {
        jobId, attempt: nextAttempt, worker: workerView(this.provider, successor),
      });
      await this.checkpointEvent(checkpoint, 'ephemeral.worker.successor_ready', {
        jobId,
        attempt,
        worker: workerView(this.provider, current),
        successor: workerView(this.provider, successor),
        resume: outcome.resume ?? null,
      });

      try {
        await finalizeHandoff({
          job,
          attempt,
          predecessor: current,
          successor,
          resume: outcome.resume ?? null,
        });
      } catch (error) {
        await this.provider.release(successor);
        await this.checkpointEvent(checkpoint, 'ephemeral.worker.handoff_failed', {
          jobId,
          attempt,
          worker: workerView(this.provider, current),
          successor: workerView(this.provider, successor),
          error: String(error?.message || error).slice(0, 240),
        });
        throw error;
      }

      await this.checkpointEvent(checkpoint, 'ephemeral.worker.handoff', {
        jobId,
        attempt,
        worker: workerView(this.provider, current),
        successor: workerView(this.provider, successor),
        resume: outcome.resume ?? null,
      });

      await this.provider.release(current);
      await this.checkpointEvent(checkpoint, 'ephemeral.worker.release', { jobId, attempt, worker: workerView(this.provider, current) });
      current = successor;
      currentResume = outcome.resume ?? null;
      attempt = nextAttempt;

      await this.checkpointEvent(checkpoint, 'ephemeral.worker.acquired', {
        jobId,
        attempt,
        worker: workerView(this.provider, current),
        resumed: true,
      });
    }
  }

  async checkpointEvent(checkpoint, type, payload) {
    await checkpoint({ type, at: this.clock().toISOString(), ...payload });
  }
}

module.exports = { EphemeralWorkerLoop, assertOutcome, workerView };
