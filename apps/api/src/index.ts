import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    await app.close();
    process.exitCode = 1;
    return;
  }

  const SHUTDOWN_TIMEOUT_MS = 30_000;

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down gracefully');

    const hardStop = setTimeout(() => {
      app.log.error({ signal }, 'Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardStop.unref();

    try {
      await app.close();
    } catch (err) {
      app.log.error({ err, signal }, 'Error during graceful shutdown');
      process.exitCode = 1;
    } finally {
      clearTimeout(hardStop);
    }
  };

  process.once('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
      console.error('Unhandled error during SIGINT shutdown:', err);
    });
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
      console.error('Unhandled error during SIGTERM shutdown:', err);
    });
  });
}

main().catch((error) => {
  console.error('Fatal error while starting RecoveryOS API:', error);
  process.exitCode = 1;
});
