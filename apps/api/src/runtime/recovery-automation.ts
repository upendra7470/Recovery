import type { FastifyBaseLogger } from 'fastify';
import type { RecoveryOperationScheduler } from '../services/recovery-operation-scheduler.service.js';

/**
 * In-process automation runtime (Phase 7).
 *
 * Deliberately tiny and isolated: the ONLY place a timer exists. Business
 * logic lives in the scheduler/service layers, so this runtime can be
 * replaced wholesale by an external job queue (BullMQ, Temporal, Cloud
 * Scheduler…) that invokes `scheduler.tick()` on its own cadence.
 */
export interface AutomationHandle {
  stop(): void;
}

export function startRecoveryAutomation(
  scheduler: RecoveryOperationScheduler,
  tickSeconds: number,
  logger: FastifyBaseLogger,
  /** Minimal structural hook surface (satisfied by the Fastify instance). */
  onCloseHook: { addHook: (name: 'onClose', fn: () => void | Promise<void>) => void }
): AutomationHandle {
  let running = false;
  const interval = setInterval(() => {
    if (running) {
      // Overlap guard: a slow tick never stacks on top of a previous one.
      return;
    }
    running = true;
    scheduler
      .tick()
      .catch((error: unknown) => {
        logger.error(
          {
            event: 'operations_tick_failed',
            error: error instanceof Error ? error.message : String(error),
          },
          'Recovery operations tick failed'
        );
      })
      .finally(() => {
        running = false;
      });
  }, tickSeconds * 1000);

  // Never keep the process alive just for the timer.
  interval.unref();

  onCloseHook.addHook('onClose', () => {
    clearInterval(interval);
    logger.info({ event: 'operations_automation_stopped' }, 'Recovery automation stopped');
  });

  logger.info(
    { event: 'operations_automation_started', tickSeconds },
    'Recovery automation started'
  );
  return {
    stop(): void {
      clearInterval(interval);
    },
  };
}
