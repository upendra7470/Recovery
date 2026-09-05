#!/usr/bin/env node

/**
 * RecoveryOS development bootstrap script.
 *
 * Runs as `predev` before `npm run dev`. Handles:
 *   1. Dependency installation (if node_modules missing)
 *   2. Environment file creation (SQLite for local dev)
 *   3. Prisma Client generation for SQLite
 *   4. Schema push to local SQLite database
 *
 * Uses only Node.js built-ins — no project dependencies required.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ──────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const API_DIR = join(ROOT, 'apps', 'api');
const WEB_DIR = join(ROOT, 'apps', 'web');
const API_ENV = join(API_DIR, '.env');
const WEB_ENV_LOCAL = join(WEB_DIR, '.env.local');
const SQLITE_DB = join(API_DIR, 'prisma', 'dev.db');
const SQLITE_SCHEMA = join(API_DIR, 'prisma', 'schema.sqlite.prisma');

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function success(msg) {
  log(`✓ ${msg}`);
}

function info(msg) {
  log(`→ ${msg}`);
}

function fail(msg) {
  log(`\n✗ ${msg}`);
  process.exit(1);
}

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 120_000 }).toString().trim();
  } catch {
    return null;
  }
}

function runOrFail(cmd, errorMessage, cwd = ROOT) {
  try {
    execSync(cmd, { cwd, stdio: 'inherit', timeout: 300_000 });
  } catch {
    fail(errorMessage);
  }
}

// ── Step 1: Dependencies ───────────────────────────────────────────────────────

function checkDependencies() {
  const nodeModules = join(ROOT, 'node_modules');
  if (existsSync(nodeModules)) {
    success('Dependencies ready');
    return;
  }

  info('Installing dependencies...');
  runOrFail('npm install', 'npm install failed. Run "npm install" manually and retry.');
  success('Dependencies installed');
}

// ── Step 2: Environment files ──────────────────────────────────────────────────

function ensureEnvironment() {
  // API .env — SQLite for local development
  if (!existsSync(API_ENV)) {
    const apiEnv = [
      'NODE_ENV=development',
      'PORT=4000',
      'HOST=0.0.0.0',
      'DATABASE_URL="file:./dev.db"',
      'LOG_LEVEL=info',
      'DEMO_MODE_ENABLED=true',
      'NEXT_PUBLIC_APP_URL=http://localhost:3000',
      'RAZORPAY_WEBHOOK_SECRET=test_webhook_secret_123',
      'DETECTION_WINDOW_HOURS=24',
      '',
    ].join('\n');
    writeFileSync(API_ENV, apiEnv, 'utf-8');
    info('Created apps/api/.env (SQLite)');
  }

  // Web .env.local
  if (!existsSync(WEB_ENV_LOCAL)) {
    const webEnv = [
      'NODE_ENV=development',
      'NEXT_PUBLIC_API_URL=http://127.0.0.1:4000',
      'NEXT_PUBLIC_APP_URL=http://localhost:3000',
      '',
    ].join('\n');
    writeFileSync(WEB_ENV_LOCAL, webEnv, 'utf-8');
    info('Created apps/web/.env.local');
  }

  success('Environment ready');
}

// ── Step 3: Prisma generation ─────────────────────────────────────────────────

function generatePrismaClient() {
  info('Generating Prisma Client for SQLite...');
  runOrFail(
    'npx prisma generate --schema prisma/schema.sqlite.prisma',
    'Prisma Client generation failed. Check the SQLite schema and try again.',
    API_DIR
  );
  success('Prisma Client generated');
}

// ── Step 4: Schema push ────────────────────────────────────────────────────────

function pushSchema() {
  info('Setting up local database...');
  runOrFail(
    'npx prisma db push --schema prisma/schema.sqlite.prisma --accept-data-loss',
    'Database schema push failed. Check the SQLite schema and try again.',
    API_DIR
  );
  success('Database ready');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log('');
  log('RecoveryOS development bootstrap');
  log('');

  checkDependencies();
  ensureEnvironment();
  generatePrismaClient();
  pushSchema();

  log('');
  log('Starting RecoveryOS...');
  log('');
}

main().catch((err) => {
  fail(`Bootstrap failed: ${err.message}`);
});
