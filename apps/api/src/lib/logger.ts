import pino from 'pino';
import type { AppEnv } from '../config/env.js';

export type Logger = pino.Logger;

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.authorization',
  '*.DATABASE_URL',
  '*.RAZORPAY_KEY_SECRET',
  '*.AUTH_SESSION_SECRET',
  '*.AI_API_KEY',
];

export function createLoggerOptions(env: Pick<AppEnv, 'NODE_ENV' | 'LOG_LEVEL'>): pino.LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    base: { service: 'recoveryos' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname,service',
            },
          },
        }
      : {}),
  };
}
