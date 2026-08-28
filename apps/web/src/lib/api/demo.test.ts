import { describe, expect, it } from 'vitest';
import { DemoApiError } from './demo';

describe('Demo API Client & Error Handling', () => {
  it('instantiates DemoApiError with code and status', () => {
    const error = new DemoApiError('DEMO_RUN_IN_PROGRESS', 'A demo run is already active', 409);
    expect(error.code).toBe('DEMO_RUN_IN_PROGRESS');
    expect(error.message).toBe('A demo run is already active');
    expect(error.status).toBe(409);
    expect(error.name).toBe('DemoApiError');
  });

  it('defaults DemoApiError status to 500 when omitted', () => {
    const error = new DemoApiError('DEMO_RUN_FAILED', 'Internal server error');
    expect(error.status).toBe(500);
  });
});
