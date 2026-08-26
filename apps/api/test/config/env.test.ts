import { describe, expect, it } from 'vitest';
import { ConfigError, envSchema, loadEnv, parseEnv } from '../../src/config/env.js';

const VALID_BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.internal:5432/recoveryos',
  AUTH_ENABLED: 'true',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
};

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db');
  });

  it('coerces PORT from a string and keeps explicit values', () => {
    const env = parseEnv({
      ...VALID_BASE,
      PORT: '8080',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
    });

    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.NODE_ENV).toBe('production');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(ConfigError);
    try {
      parseEnv({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.issues.join('\n')).toContain('DATABASE_URL');
    }
  });

  it('rejects connection strings that are not PostgreSQL URLs', () => {
    expect(() =>
      parseEnv({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' })
    ).toThrow(ConfigError);

    expect(() => parseEnv({ DATABASE_URL: 'not-a-url' })).toThrow(ConfigError);
  });

  it('rejects an unknown NODE_ENV value', () => {
    expect(() => parseEnv({ ...VALID_BASE, NODE_ENV: 'staging' })).toThrow(ConfigError);
  });

  it('rejects an unknown log level', () => {
    expect(() => parseEnv({ ...VALID_BASE, LOG_LEVEL: 'loud' })).toThrow(ConfigError);
  });

  it('rejects a non-numeric port', () => {
    expect(() => parseEnv({ ...VALID_BASE, PORT: 'four-thousand' })).toThrow(ConfigError);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseEnv({ ...VALID_BASE, PORT: '70000' })).toThrow(ConfigError);
  });

  it('treats RAZORPAY_WEBHOOK_SECRET as optional to preserve existing environments', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBeUndefined();
  });

  it('keeps a provided RAZORPAY_WEBHOOK_SECRET', () => {
    const env = parseEnv({
      ...VALID_BASE,
      RAZORPAY_WEBHOOK_SECRET: 'whsec_abc',
    });
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBe('whsec_abc');
  });

  it('normalizes blank optional values to undefined', () => {
    const env = parseEnv({
      ...VALID_BASE,
      DEFAULT_TEST_PAYMENT_ACCOUNT_ID: '',
      RAZORPAY_WEBHOOK_SECRET: '   ',
    });
    expect(env.DEFAULT_TEST_PAYMENT_ACCOUNT_ID).toBeUndefined();
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBeUndefined();
  });

  it('rejects a non-uuid DEFAULT_TEST_PAYMENT_ACCOUNT_ID', () => {
    expect(() =>
      parseEnv({ ...VALID_BASE, DEFAULT_TEST_PAYMENT_ACCOUNT_ID: 'not-a-uuid' })
    ).toThrow(ConfigError);
  });

  it('defaults DETECTION_WINDOW_HOURS to 24', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(env.DETECTION_WINDOW_HOURS).toBe(24);
  });

  it('coerces DETECTION_WINDOW_HOURS from a string and keeps explicit values', () => {
    const env = parseEnv({ ...VALID_BASE, DETECTION_WINDOW_HOURS: '72' });
    expect(env.DETECTION_WINDOW_HOURS).toBe(72);
  });

  it('rejects an out-of-range DETECTION_WINDOW_HOURS', () => {
    expect(() => parseEnv({ ...VALID_BASE, DETECTION_WINDOW_HOURS: '0' })).toThrow(ConfigError);
    expect(() => parseEnv({ ...VALID_BASE, DETECTION_WINDOW_HOURS: '721' })).toThrow(ConfigError);
  });

  it('rejects a non-integer DETECTION_WINDOW_HOURS', () => {
    expect(() => parseEnv({ ...VALID_BASE, DETECTION_WINDOW_HOURS: '1.5' })).toThrow(ConfigError);
  });

  it('disables recovery automation by default and applies conservative bounds', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(env.RECOVERY_AUTOMATION_ENABLED).toBe(false);
    expect(env.RECOVERY_MAX_ATTEMPTS).toBe(3);
    expect(env.RECOVERY_OPERATION_MAX_AGE_HOURS).toBe(72);
    expect(env.RECOVERY_RETRY_BACKOFF_SECONDS).toBe(300);
    expect(env.RECOVERY_AUTOMATION_TICK_SECONDS).toBe(30);
  });

  it('parses strict automation booleans (the string "false" is false)', () => {
    const off = parseEnv({ ...VALID_BASE, RECOVERY_AUTOMATION_ENABLED: 'false' });
    expect(off.RECOVERY_AUTOMATION_ENABLED).toBe(false);
    expect(() =>
      parseEnv({ ...VALID_BASE, RECOVERY_AUTOMATION_ENABLED: 'TRUE' })
    ).toThrow(ConfigError);
  });

  it('rejects out-of-range automation values', () => {
    expect(() => parseEnv({ ...VALID_BASE, RECOVERY_MAX_ATTEMPTS: '0' })).toThrow(ConfigError);
    expect(() => parseEnv({ ...VALID_BASE, RECOVERY_MAX_ATTEMPTS: '11' })).toThrow(ConfigError);
    expect(() =>
      parseEnv({ ...VALID_BASE, RECOVERY_RETRY_BACKOFF_SECONDS: '0' })
    ).toThrow(ConfigError);
    expect(() =>
      parseEnv({ ...VALID_BASE, RECOVERY_AUTOMATION_TICK_SECONDS: '2' })
    ).toThrow(ConfigError);
  });
});

describe('loadEnv', () => {
  it('defaults to process.env as the source', () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/from-process-env';

    try {
      const env = loadEnv();
      expect(env.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/from-process-env');
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original;
      }
    }
  });
});

describe('envSchema', () => {
  it('allows every documented log level plus silent for tests', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) {
      expect(() =>
        envSchema.parse({ ...VALID_BASE, LOG_LEVEL: level })
      ).not.toThrow();
    }
  });
});
