# Changelog

All notable changes to RecoveryOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `ProviderError` class for external service errors with `code`, `provider`, and `retryable` fields
- Edge-case test fixtures for Razorpay adapter: minimal payments, zero amounts, negative amounts, missing fields, future timestamps
- Edge-case unit tests for Razorpay adapter normalization and validation
- CHANGELOG.md file

### Changed
- Upgraded generic `throw new Error` sites to typed errors (`ValidationError`, `ConflictError`, `NotFoundError`, `InternalError`) in:
  - `demo.service.ts`: Demo mode disabled and concurrent run guards
  - `synthetic-event-replay.service.ts`: Simulation mode disabled, concurrent replay, and missing dataset guards
  - `synthetic-data.generator.ts`: Invalid distribution validation
  - `seeded-random.ts`: Array length mismatch validation
  - `recovery-execution.service.ts`: Unexpected outcome handling

### Fixed
- CSS layout issues in Recovery Modules page (metrics grid responsive sizing, truncation, header/footer)

## [1.0.0] - 2026-09-03

### Added
- Revenue leakage detection engine with configurable rules
- Deterministic decision engine with safety-first policy
- AI advisory layer with OpenAI-compatible provider and demo mode
- Controlled recovery execution with Razorpay integration
- Merchant memory system for learning from past outcomes
- Recovery modules for subscriptions, mandates, B2B invoicing, and checkout
- Synthetic data generation with seeded PRNG for reproducibility
- Event replay engine for deterministic simulation
- Judge Mode for automated scenario evaluation
- Merchant dashboard with real-time metrics
- Demo Mode with live command center
- Authentication system with session management
- Graceful shutdown with 30s timeout
- Request ID correlation via `x-request-id` header
- Comprehensive error handling with typed error classes
- Security headers (HSTS, CSP, etc.)
- Docker support with multi-stage builds
- CI/CD pipeline with linting, type checking, and testing

### Security
- Environment variable sanitization in error messages
- Request ID propagation for traceability
- Body size limits (1MB)
- CORS configuration for browser clients
