# RecoveryOS

AI-powered revenue recovery intelligence platform for modern payment operations.

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd recoveryos
npm install

# 2. Start database
docker compose up -d db

# 3. Set up environment
cp .env.example .env
npm run setup    # optional: interactive setup

# 4. Run migrations
npm run db:migrate:deploy

# 5. Start dev servers
npm run dev
```

**API:** http://localhost:4000 · **Web:** http://localhost:3000

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design, safety model, and data flow.

## Demo Mode

```bash
# Enable demo mode in .env
DEMO_MODE_ENABLED=true

# Hit the demo endpoint
curl -X POST http://localhost:4000/demo/run/successful
```

## Docker

```bash
# Full stack with database
docker compose up --build

# Database only
docker compose up db -d
```

## Project Structure

```
recoveryos/
├── apps/
│   ├── api/          # Fastify 5 + Prisma 6 + PostgreSQL
│   └── web/          # Next.js 16 + React 19 + Tailwind CSS 4
├── docs/
│   └── ARCHITECTURE.md
├── docker-compose.yml
└── .env.example
```

## Testing

```bash
npm run test          # All tests
npm run test -w @recoveryos/api   # API tests only
npm run test -w @recoveryos/web   # Web tests only
```

## Lint & Typecheck

```bash
npm run lint
npm run typecheck
```

## License

Private — All rights reserved.
