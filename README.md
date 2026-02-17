# Production-Ready Node.js Backend Starter

A production-ready boilerplate for quickly building scalable RESTful APIs using **Node.js**,
**Express**, **Mongoose** and **TypeScript**.

You will get a robust, type-safe backend environment installed and configured on your machine. The
app comes with many enterprise-grade built-in features, such as **authentication** using **JWT**,
**request validation** using **Zod**, **background workers** using **BullMQ**, **Redis-based rate
limiting**, **environment-aware logging** with **daily rotation** using **daily-rotate-file**, and
**Multilanguage support** using **i18n**. It is designed for operational excellence, featuring
**AsyncLocalStorage tracing**, **Kubernetes-ready health checks**, and a defensive **Soft Delete**
architecture protected by custom ESLint rules and Husky.

Docker containerization, email verification, password reset, Prometheus metrics, and documentation
could be added in the future.

<br />

## Installation & Running

- `git clone https://github.com/ulasdnz/node-ts-backend-starter.git`
- `cd node-ts-backend-starter`
- `npm install`
- Prepare the environment variables by generating `.env` file just as `.example.env` file
- `npm run dev` (for development) or `npm start` (for production)

<br />

## Table of Contents

- [Features](#features)
- [Environment Variables](#environment-variables)
- [Database Management](#database-management)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Architecture & Design Decisions](#architecture--design-decisions)
  - [Soft Delete Architecture](#-soft-delete-plugin-mechanism)
- [Resilience](#resilience)
- [Observability & Error Semantics](#observability--error-semantics)

<br />

## Features

- **NoSQL Database:** **MongoDB** object data modeling using **Mongoose**
- **Mongoose Soft Delete Plugin:** featuring a defensive 3-layer **Soft Delete** architecture
  (Plugin + ESLint Husky Prevention + BullMQ Purging).
- **Background Jobs:** Event-driven background processing and fail-safe scheduling using **Redis** &
  **BullMQ**.
- **Authentication & Authorization:** Secure stateless authentication using **JWT** with role-based
  access control.
- **Validation:** Strict runtime and compile-time request data validation using **Zod** (headers,
  body, params, query).
- **Logging & Observability:** Environment-aware structured logging with **Winston** (daily
  rotation) and distributed request tracing via **AsyncLocalStorage**.
- **Testing:** Unit testing suite powered by **Vitest**.
- **Rate Limiting:** Distributed rate limiting backed by **Redis**.
- **Multilanguage Support:** Internationalization (i18n) support using **i18n**.
- **Health Checks:** Kubernetes-ready endpoints (`/health`, `/health/ready`, `/health/live`) for
  deep system monitoring.
- **Code Quality:** Enforced coding standards via **ESLint** (custom Mongoose rules), **Prettier**,
  and **Husky** git hooks (lint-staged, commitlint).
- **Environment Configuration:** Type-safe configuration using **dotenv** and **Zod**, with
  **fail-fast validation** (app crashes immediately if env vars are invalid).
- **Error Handling:** Centralized error handling mechanism with standardized JSON responses and
  environment-specific stack trace policies.
- **Compression:** Response body compression using **compression** (gzip).
- **File Uploading:** Multipart/form-data handling using **Multer**.
- **Security:** Set security HTTP headers using **Helmet**.
- **CORS:** Cross-Origin Resource-Sharing enabled using **cors**.

<br />

### Environment Variables

The environment variables should be set in a `.env` file just as `.example.env` file.

| Variable                       | Default       | Description                               |
| ------------------------------ | ------------- | ----------------------------------------- |
| `NODE_ENV`                     | `development` | `development` / `production` / `test`     |
| `PORT`                         | `3000`        | Server port                               |
| `MONGO_URI`                    | —             | MongoDB connection string                 |
| `JWT_SECRET`                   | —             | Secret for JWT signing                    |
| `REDIS_URL`                    | —             | Redis connection URL                      |
| `LOG_LEVEL`                    | `info`        | Winston log level                         |
| `USER_DELETION_RETENTION_DAYS` | `14`          | Days before soft-deleted users are purged |

<br />

## Database Management

### Migrations

Run all pending migrations:

```bash
npm run migrate
```

Create a new migration file:

```bash
npm run migration:create <migration-name>
```

Example:

```bash
npm run migration:create add-user-fields
```

This generates a timestamped file in `src/database/migrations/` (e.g.,
`20260113003842-add-user-fields.ts`) with `up()` and `down()` functions. Migrations use
`mongoose.connection.collection('name')` instead of Model imports to ensure decoupling.

### Seeders

Populate the database with sample data:

```bash
npm run seed
```

This will:

- Clear existing users collection
- Insert 10 sample users (1 admin + 9 regular users)
- All seeded users have the password: `Test123456`

<br />

## Project Structure

```
src/
├── app.ts                           # Entry point, server bootstrap
├── config/
│   └── index.ts                     # Zod-validated environment config
├── core/
│   ├── errors/
│   │   └── index.ts                 # CustomError class
│   ├── loaders/
│   │   ├── index.ts                 # Orchestrates all loaders
│   │   ├── express.ts               # Express middleware setup
│   │   ├── mongoose.ts              # MongoDB connection
│   │   └── i18n.ts                  # i18next initialization
│   ├── middleware/
│   │   ├── auth/
│   │   │   ├── authenticate.ts      # JWT verification
│   │   │   └── authorize.ts         # Role-based access control
│   │   ├── error-handler.ts         # Centralized error handling
│   │   ├── rate-limiter.ts          # Redis-backed rate limiting
│   │   ├── request-context.ts       # AsyncLocalStorage for tracing
│   │   ├── upload.ts                # Multer file upload
│   │   └── validate.ts              # Zod validation middleware
│   ├── types/
│   │   ├── index.ts                 # Shared type definitions
│   │   ├── api.types.ts             # API response types
│   │   ├── express.d.ts             # Express augmentations
│   │   └── mongo.types.ts           # MongoDB type definitions
│   └── utils/                       # Core utilities
├── database/
│   ├── migrations/
│   │   ├── index.ts                 # Migration orchestrator
│   │   ├── README.md                # Migration documentation
│   │   └── 20260102205332-add-user-index.ts
│   ├── plugins/
│   │   └── softDelete.plugin.ts     # Mongoose soft delete plugin
│   └── seeders/
│       ├── index.ts                 # Seeder orchestrator
│       └── user.seeder.ts           # User seed data
├── jobs/
│   ├── index.ts                     # Job system initialization
│   ├── queues.ts                    # BullMQ queue definitions
│   ├── workers.ts                   # Worker process management
│   └── cleanup/
│       ├── purge.scheduler.ts       # Daily purge scanner
│       └── purge.worker.ts          # Purge job processor
├── lib/
│   ├── logger.ts                    # Winston logger configuration
│   ├── redis.ts                     # Redis client (ioredis)
│   └── plugins/                     # Library plugins
├── modules/
│   ├── health/                      # Infrastructure-level health & probe endpoints
│   │   ├── health.routes.ts         # Express route definitions for health endpoints
│   │   ├── health.controller.ts     # HTTP-layer orchestration and probe semantics
│   │   ├── health.service.ts        # Dependency checks (MongoDB, Redis) with timeouts
│   │   └── health.types.ts          # Typed health response contracts
│   └── user/
│       ├── __tests__/               # User module tests
│       ├── user.controller.ts       # Request handlers
│       ├── user.model.ts            # Mongoose schema + soft delete
│       ├── user.routes.ts           # Route definitions
│       ├── user.service.ts          # Business logic
│       ├── user.types.ts            # Module-specific types
│       └── user.validators.ts       # Zod schemas
├── scripts/
│   └── create-migration.ts          # Migration scaffold utility
├── test/
│   └── setup.ts                     # Vitest global setup
└── utils/
    ├── db.ts                        # Database utilities
    ├── validators.ts                # Shared validation utilities
    └── lang/
        ├── en.json                  # English translations
        └── tr.json                  # Turkish translations

eslint/
├── plugin-mongoose-safety.js        # Custom ESLint plugin
└── rules/
    ├── aggregate-policy.js          # Enforce aggregateSafe()
    └── no-hard-delete.js            # Block hard delete methods
```

<br />

## API Reference

### Authentication

| Method | Endpoint                | Description       | Auth |
| ------ | ----------------------- | ----------------- | ---- |
| POST   | `/api/v1/auth/register` | Register new user | —    |
| POST   | `/api/v1/auth/login`    | Login, get JWT    | —    |

### User Management

| Method | Endpoint                  | Description         | Auth   |
| ------ | ------------------------- | ------------------- | ------ |
| GET    | `/api/v1/users/me`        | Get current user    | Bearer |
| PATCH  | `/api/v1/users/me`        | Update current user | Bearer |
| PATCH  | `/api/v1/users/me/avatar` | Update avatar       | Bearer |
| DELETE | `/api/v1/users/me`        | Soft delete account | Bearer |

### Admin Routes

| Method | Endpoint            | Description               | Auth         |
| ------ | ------------------- | ------------------------- | ------------ |
| GET    | `/api/v1/users`     | List users (with filters) | Bearer+Admin |
| GET    | `/api/v1/users/:id` | Get user by ID            | Bearer+Admin |

### Health Checks

| Method | Endpoint        | Description        |
| ------ | --------------- | ------------------ |
| GET    | `/health`       | Full system health |
| GET    | `/health/ready` | Readiness probe    |
| GET    | `/health/live`  | Liveness probe     |

<br />

## Architecture & Design Decisions

This section documents how **soft deletion** and **data lifecycle management** are handled in this
codebase.

## 🧩 Soft Delete Plugin (Mechanism)

The soft-delete mechanism is implemented via a **custom Mongoose plugin** developed specifically for
this project (`plugins/softDelete.plugin.ts`). The plugin is intentionally **opt-in and
model-scoped**. Applying it to a schema explicitly signals that:

- Records must be recoverable
- Deletion must be observable and reversible
- Hard deletes are unsafe by default

> Models that do not apply this plugin retain full freedom, including immediate hard deletes.

### What the Plugin Adds

#### Schema Fields

Once applied, the plugin injects the following **non-optional** fields:

| Field       | Type           | Purpose            | Description                             |
| ----------- | -------------- | ------------------ | --------------------------------------- |
| `deleted`   | `boolean`      | Soft-delete marker | Indicates logical deletion state        |
| `deletedAt` | `Date \| null` | Deletion timestamp | Time when the document was soft-deleted |

#### Static Model APIs

The plugin augments the model with **explicit, intention-revealing static methods**:

| Method                             | Behavior                                               |
| ---------------------------------- | ------------------------------------------------------ |
| `softDeleteById(id)`               | Marks document as deleted and timestamps it            |
| `restoreById(id)`                  | Restores a soft-deleted document                       |
| `countActive(filter?)`             | Counts only non-deleted documents                      |
| `updateManyActive(filter, update)` | Updates only active documents                          |
| `aggregateSafe(pipeline)`          | Runs aggregation with enforced soft-delete constraints |

There is **no generic delete API** exposed by the plugin. Any hard delete must bypass the model
layer entirely and is therefore highly visible.

#### Query Helpers (Chainable)

The plugin modifies default query semantics while keeping intent explicit:

```ts
// Default: excludes deleted documents
await User.find({ role: 'admin' });

// Explicit opt-in
await User.find().withDeleted();
await User.find().onlyDeleted();
```

All queries implicitly scope to `{ deleted: false }` unless explicitly overridden.

#### Aggregation Safety (`aggregateSafe`)

Aggregations are a common escape hatch for soft-delete rules. `aggregateSafe()` exists to close that
gap **without breaking advanced pipelines**.

Only models that apply the plugin are subject to these rules.

| First Pipeline Stage                      | Handling                                        |
| ----------------------------------------- | ----------------------------------------------- |
| `$geoNear`                                | Injects `deleted=false` into `$geoNear.query`   |
| `$search`, `$vectorSearch`, `$searchMeta` | Allowed; caller must apply filtering explicitly |
| Default                                   | Prepends `{ $match: { deleted: false } }`       |

This avoids silent data leaks while keeping aggregation behavior predictable.

## 🛡️ Data Deletion Lifecycle (Policy)

**Hard deletes are forbidden** for those models that uses **soft delete plugin.** A 3-layer deletion
strategy ensures **records** are deleted safely, meaning that the deleted **data entities** are not
permanently removed from the database for a configurable amount of time. This is done to prevent
data loss and to ensure that the data can be restored if needed.

At present, this lifecycle is enabled **only for the `User` model**.

### Why Only Users?

User data is uniquely sensitive:

- Accidental deletion is irreversible
- Legal or regulatory retention may apply
- Account recovery is a real product requirement

Other entities may legitimately require immediate hard deletion. Applying soft delete globally would
be incorrect.

This results in a system that is:

- **Scoped** (per-model)
- **Explicit** (opt-in)
- **Composable** (reusable where justified)

### High-Level Lifecycle

```
┌─────────────────────┐
│  1. SOFT DELETE     │  DELETE /api/v1/users/me
│     (Immediate)     │  → deleted=true, deletedAt=now
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  2. QUEUE JOB       │  BullMQ job scheduled with configurable delay
│     (Retention)     │  → Default: USER_DELETION_RETENTION_DAYS (14d)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  3. HARD DELETE     │  Worker-verified purge
│     (Final)         │  → double-checked
└─────────────────────┘
```

At no point can application code directly hard-delete a user.

## Defense-in-Depth

User deletion safety is enforced through **three independent layers**. Each layer assumes the others
may fail.

| Layer | Scope                 | Mechanism           | Purpose                                  |
| ----: | --------------------- | ------------------- | ---------------------------------------- |
|    L1 | Authoring & Commit    | ESLint + Husky      | Prevent unsafe code from being committed |
|    L2 | Runtime               | Mongoose Plugin     | Enforce rules during execution           |
|    L3 | Background Processing | BullMQ + Schedulers | Guarantee eventual consistency           |

## Layer 1 — Authoring & Commit-Time Enforcement

Custom ESLint rules detect unsafe Mongoose usage **only inside modules that opt into soft delete**.

### Scoped Enforcement

Rules are intentionally scoped at the module level to avoid global coupling:

```ts
files: [
  'src/modules/user/**/*.{ts,js}',
  // explicitly add other modules if they adopt soft delete
];
```

This prevents false positives in domains where hard deletes are valid.

### Enforced Rules

| Rule                               | Purpose                          |
| ---------------------------------- | -------------------------------- |
| `mongoose-safety/no-hard-delete`   | Blocks unsafe delete methods     |
| `mongoose-safety/aggregate-policy` | Enforces `aggregateSafe()` usage |

Rules run via **Husky pre-commit hooks** (`lint-staged`). Unsafe deletion code cannot be committed.

## Layer 2 — Runtime Enforcement

Even if static analysis is bypassed, the plugin enforces rules at runtime:

```ts
// ⛔ Blocked
await User.deleteOne({ _id: userId });

// ✅ Allowed
await User.softDeleteById(userId);
```

Queries default to excluding deleted users unless explicitly overridden.

## Layer 3 — Deferred Purge & Recovery (BullMQ)

Deletion is a **workflow**, not a single operation.

### Retention Window

A configurable grace period allows:

- Account recovery
- Cancellation of accidental deletes
- Operational inspection

### Verified Purge

Before hard deletion, the worker re-validates all conditions:

```ts
await User.collection.deleteOne({
  _id: ObjectId(userId),
  deleted: true,
  deletedAt: { $lte: retentionDate },
});
```

### Daily Fail-Safe Scanner

A scheduled job scans for eligible users daily and enqueues idempotent purge jobs. This guarantees
cleanup even after outages or missed delays.

### Automatic Recovery

If a user logs in during the retention window:

- The account is restored
- The purge job is cancelled

No special recovery endpoint is required.

## Design Summary

- Soft delete is **mechanism**, not policy
- The plugin defines capabilities; domains define rules
- User deletion is conservative, verified, and recoverable
- Other models remain free to choose simpler semantics

<br />

## Resilience

### Health Checks

The service exposes explicit health endpoints intended for **infrastructure-level traffic
decisions** (load balancers, Kubernetes probes) and **basic human inspection** (dashboards, manual
checks).

Health checks are intentionally **binary**: an instance either **can** accept traffic or it **must
not**.

#### Endpoints

| Endpoint        | Purpose                                  | MongoDB      | Redis       | Status Codes |
| --------------- | ---------------------------------------- | ------------ | ----------- | ------------ |
| `/health`       | High-level system health (informational) | **Critical** | Optional    | 200 / 503    |
| `/health/ready` | Readiness probe (traffic gating)         | **Required** | Not checked | 200 / 503    |
| `/health/live`  | Liveness probe (process alive)           | N/A          | N/A         | 200          |

#### Semantics

- **MongoDB** is treated as a _critical dependency_:
  - If unavailable, the service is considered **unhealthy**
  - Traffic must not be routed to the instance

- **Redis** is used exclusively for asynchronous and scheduled background work (e.g. cleanup jobs,
  deferred hard deletes) and is not part of the synchronous request path:
  - Redis failures do **not** block traffic
  - Failures are surfaced via logs and monitoring only

- **Readiness is binary**:
  - `200` → instance can safely receive traffic
  - `503` → instance must be removed from rotation

- **Liveness is minimal by design**:
  - No dependency checks
  - Used only to decide whether the process should be restarted

#### Timeouts & Failure Isolation

All dependency checks are executed with a **1500ms timeout** to:

- Prevent cascading failures
- Avoid blocking the event loop on slow or hanging dependencies
- Keep health endpoints responsive under partial outages

Failures and timeouts are intentionally surfaced via **structured logs**, not exposed through HTTP
responses.

#### Design Rationale

- Health endpoints are **machine-facing contracts**, not diagnostic APIs
- Optional dependencies must never affect traffic routing decisions
- Detailed failure information belongs in logs and metrics, not in responses
- The model is compatible with both **monolith** and **microservice** deployments

<br />

## Observability & Error Semantics

This project treats **observability as a first-class concern**, not an afterthought. The logging and
error-handling model is designed to support **production debugging, incident analysis, and
request-level traceability** without leaking sensitive information to clients.

The system explicitly distinguishes between **operational failures** (expected, client-driven
errors) and **system failures** (unexpected, infrastructure or programming errors).

### Request Context Propagation (Trace ID & Client IP)

Every incoming request is enriched with a **request context** at the middleware layer. This context
is propagated across the entire request lifecycle using `AsyncLocalStorage`.

The request context contains:

- `traceId`
  - Accepted from `X-Trace-Id` header if provided
  - Generated per request otherwise
- `ip`
  - Derived from `req.ip`
  - Captures the client source for audit and security analysis

Both values are:

- Automatically attached to **all application logs**
- Included in structured file logs
- Used for correlating HTTP access logs and error logs
- `traceId` is returned to the client via the `X-Trace-Id` response header

This guarantees that:

- A single request can be followed end-to-end
- Client-reported errors can be traced back to a specific source
- Security incidents and abuse patterns can be analyzed post-facto

### Environment-Aware Logging Strategy

Logging behavior is intentionally **environment-aware**, balancing fast local feedback with
production-grade observability and operational safety.

| Aspect               | Development                | Production                                |
| -------------------- | -------------------------- | ----------------------------------------- |
| Console Output       | Colorized, human-readable  | Same                                      |
| File Logging         | Disabled                   | JSON, daily rotated (14d retention, 20MB) |
| Trace ID             | Logged + response header   | Same                                      |
| Client IP            | Logged (context-enriched)  | Same                                      |
| Stack Traces in API  | Included for debugging     | Never exposed                             |
| Stack Traces in Logs | Captured for system errors | Always captured                           |

In non-production environments, logs are written **only to the console** to maximize development
speed and readability.

In production, structured JSON logs are written to rotating files for post-mortem analysis,
auditing, and integration with log aggregation systems.

### Log Levels & Error Classification

Log severity reflects **operational intent**, not just HTTP status codes.

Errors are **explicitly classified** instead of relying on HTTP status codes alone.

#### Operational Errors (`4xx`)

Expected failures caused by invalid input or user actions.

Examples:

- Validation errors (Zod)
- Authentication / authorization failures
- Domain and business rule violations

Behavior:

- Logged as `warn`
- No stack trace
- Enriched with `traceId`, `ip`, method and path
- Client receives a meaningful, localized message

#### System Errors (`5xx`)

Unexpected failures indicating bugs or infrastructure issues.

Examples:

- Unhandled exceptions
- Programming errors
- Database or dependency failures

Behavior:

- Logged as `error`
- Full stack trace captured
- Enriched with `traceId`, `ip`, method and path
- Client receives a generic message + trace ID reference

```ts
if (!isOperational) {
  logger.error(logMessage, { ...logPayload, stack });
} else {
  logger.warn(logMessage, logPayload);
}
```

This prevents log noise while preserving high-signal diagnostics for real failures.

### Structured Error Responses

All API errors follow a strict response contract:

```ts
{
  success: false,
  message: string,
  errors?: Array<{ field: string | number; message: string }>
}

```

Guarantees:

- **No internal details leak in production**
  - Stack traces, internal error messages, and implementation details are never exposed to clients
    outside development mode.
  - Production responses remain intentionally generic while still being traceable via `traceId`.

- **Stable and predictable error shape**
  - Error responses always follow the same structural contract.
  - Clients can rely on the presence of `success` and `message` without defensive parsing or
    environment-specific branching.

- **Field-level validation feedback**
  - Validation failures are mapped to individual fields when applicable.
  - Unknown or disallowed fields are explicitly reported instead of being silently ignored.

- **Traceable client-facing failures**
  - Every error response can be correlated with server-side logs using `traceId`.
  - This enables support, debugging, and incident response without exposing internals.

- **Localization-safe messaging**
  - All client-facing messages are resolved through the **i18n** layer.
  - Logs use a fixed language to ensure consistency during incident analysis.

- **Environment-aware verbosity**
  - Development prioritizes debuggability.
  - Production prioritizes safety and operational clarity.

### Failure Semantics & Operator Experience

The system is designed around the assumption that:

- **Client errors are expected**
- **System errors are exceptional**
- **Logs are for operators, not for users**

As a result:

- `4xx` errors are treated as part of normal operation
- `5xx` errors are treated as signals requiring investigation
- Log severity reflects intent, not just HTTP status codes

Operational failures remain visible without polluting error monitoring, while system failures
surface with full diagnostic context.

### Production Safety Guarantees

The system enforces the following guarantees in production:

- No stack traces are exposed to end users in production
- All unexpected failures are logged with:
  - `traceId`
  - client `ip`
  - HTTP method and path
  - full stack trace
- Log files are rotated, size-limited, and retention-controlled
- Structured logs are suitable for aggregation and alerting systems

These guarantees ensure the system remains **debuggable under failure** without compromising
security or leaking sensitive implementation details.

### Design Principles

- **Observability is a feature, not a side effect**
- **Request context is implicit, not manually threaded**
- **Errors are classified intentionally**
- **Production safety always outweighs debugging convenience**
- **Logs serve operators, responses serve clients**

This approach favors explicit behavior, operational correctness, and long-term maintainability over
framework-driven abstractions or demo-oriented shortcuts.
