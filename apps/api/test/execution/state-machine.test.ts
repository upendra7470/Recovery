import { describe, expect, it } from 'vitest';
import {
  canTransition,
  InvalidExecutionTransitionError,
  isTerminal,
  requireTransition,
} from '../../src/execution/state-machine.js';

describe('execution state machine', () => {
  it('allows exactly the documented transitions', () => {
    expect(canTransition('PENDING', 'AUTHORIZED')).toBe(true);
    expect(canTransition('PENDING', 'BLOCKED')).toBe(true);
    expect(canTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransition('AUTHORIZED', 'EXECUTING')).toBe(true);
    expect(canTransition('AUTHORIZED', 'CANCELLED')).toBe(true);
    expect(canTransition('EXECUTING', 'SUCCEEDED')).toBe(true);
    expect(canTransition('EXECUTING', 'FAILED')).toBe(true);
  });

  it('rejects arbitrary jumps and backwards transitions', () => {
    expect(canTransition('PENDING', 'EXECUTING')).toBe(false);
    expect(canTransition('PENDING', 'SUCCEEDED')).toBe(false);
    expect(canTransition('PENDING', 'FAILED')).toBe(false);
    expect(canTransition('AUTHORIZED', 'SUCCEEDED')).toBe(false);
    expect(canTransition('AUTHORIZED', 'BLOCKED')).toBe(false);
    expect(canTransition('EXECUTING', 'AUTHORIZED')).toBe(false);
    expect(canTransition('EXECUTING', 'BLOCKED')).toBe(false);
    expect(canTransition('BLOCKED', 'PENDING')).toBe(false);
    expect(canTransition('CANCELLED', 'EXECUTING')).toBe(false);
  });

  it('rejects self-transitions', () => {
    for (const status of ['PENDING', 'AUTHORIZED', 'EXECUTING'] as const) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('treats SUCCEEDED/FAILED/BLOCKED/CANCELLED as terminal', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED'] as const) {
      expect(isTerminal(status)).toBe(true);
      for (const next of ['PENDING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'FAILED'] as const) {
        expect(canTransition(status, next)).toBe(false);
      }
    }
  });

  it('requireTransition throws deterministically on invalid transitions', () => {
    expect(() => requireTransition('PENDING', 'SUCCEEDED')).toThrow(
      InvalidExecutionTransitionError
    );
    try {
      requireTransition('PENDING', 'SUCCEEDED');
    } catch (error) {
      expect((error as InvalidExecutionTransitionError).from).toBe('PENDING');
      expect((error as InvalidExecutionTransitionError).to).toBe('SUCCEEDED');
    }
  });
});
