# Production-Ready Node.js Backend Starter

A production-ready boilerplate for building RESTful APIs with **Node.js**, **Express 5**,
**Mongoose** and **TypeScript**.

It comes with **JWT authentication** whose tokens can be revoked, **brute-force protection** for
sign-in, **request validation** with **Zod**, **background jobs** with **BullMQ**, **Redis-backed
rate limiting and caching**, **structured JSON logging** ready for Google Cloud Logging, an **audit
log**, tracked **migrations** and **multilanguage** messages with **i18next**. It is designed for
operational excellence: **AsyncLocalStorage tracing**, **Kubernetes-ready health checks**, graceful
shutdown, and a defensive **Soft Delete** architecture protected by custom ESLint rules and Husky.

Docker containerization, email verification, password reset by email, Prometheus metrics, and API
documentation could be added in the future.

<br />

## Installation & Running

Requires Node.js 26 or later, MongoDB and Redis.

```bash
git clone https://github.com/ulasdnz/node-ts-backend-starter.git
cd node-ts-backend-starter
npm install
cp .env.example .env   # then fill in the values, see Environment Variables
npm run migrate        # applies migrations and builds indexes
npm run dev
```

In production, build once, run the migrate step before the new version starts, then start it:

```bash
npm run build
npm run migrate:prod
npm start
```

### Scripts

| Script                                 | What it does                                                       |
| -------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                          | Starts the API and restarts it on changes                          |
| `npm run build`                        | Empties `dist/` and compiles the app into it                       |
| `npm start`                            | Runs the compiled app                                              |
| `npm run migrate` / `migrate:prod`     | Applies pending migrations, then builds indexes (source / `dist/`) |
| `npm run migration:create <name>`      | Creates a migration file from the template                         |
| `npm run seed`                         | Replaces every user with development data; refused in production   |
| `npm test` / `npm run test:coverage`   | Runs the tests against an in-memory MongoDB; no Redis needed       |
| `npm run lint` / `typecheck` / `check` | ESLint with type information, `tsc`, or both followed by the tests |

<br />

## Table of Contents

- [Installation & Running](#installation--running)
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

- **NoSQL Database:** **MongoDB** object data modeling using **Mongoose**.
- **Mongoose Soft Delete Plugin:** a defensive 3-layer **Soft Delete** architecture (plugin + ESLint
  and Husky prevention + BullMQ purging).
- **Audit Log:** a Mongoose plugin records who created, changed or removed a document, with the
  request's user, trace id and IP, and sensitive fields masked.
- **Background Jobs:** queues and workers built by one factory with retries, retention and trace id
  propagation, using **Redis** and **BullMQ**.
- **Authentication & Authorization:** stateless **JWT**s that carry only the user id. Role and
  account state come from a Redis-cached auth context, so a password change, a deactivation or a
  deletion revokes tokens at once. Role-based access control on top.
- **Login Protection:** consecutive failures lock an email and IP pair, a daily budget caps failures
  per IP, and unknown emails cost the same bcrypt work as wrong passwords.
- **Validation:** request body, params and query validated with **Zod**; errors name the field.
- **Pagination:** page, limit and sort, with an allow list of sort fields and a stable order.
- **Migrations:** tracked, locked against concurrent runs, and run as a deploy step that also builds
  indexes.
- **Logging & Observability:** structured **Winston** logs (JSON with Cloud Logging severity in
  production, readable lines in development) and request tracing via **AsyncLocalStorage**.
- **Testing:** unit and integration tests with **Vitest**, **supertest** and an in-memory MongoDB.
- **Rate Limiting:** distributed rate limiting backed by **Redis**, with an in-memory fallback.
- **Multilanguage Support:** localized messages (English and Turkish) using **i18next**.
- **Health Checks:** Kubernetes-ready endpoints (`/health`, `/health/ready`, `/health/live`).
- **Graceful Shutdown:** in-flight requests finish, then jobs, Redis and MongoDB close in order.
- **Code Quality:** **ESLint** with type information and custom Mongoose rules, **Prettier**, and
  **Husky** git hooks (lint-staged, commitlint).
- **Environment Configuration:** type-safe configuration validated with **Zod** at startup; invalid
  values stop the app before it serves anything.
- **Error Handling:** one error handler and one JSON error contract; stack traces only in
  development.
- **Compression:** response body compression using **compression** (gzip).
- **File Uploading:** multipart/form-data handling using **Multer**, with content-based image
  checks.
- **Security:** security HTTP headers using **Helmet**.
- **CORS:** Cross-Origin Resource Sharing using **cors**.

<br />

### Environment Variables

Copy `.env.example` to `.env` for local development; in production the platform provides them.
Invalid values stop the app at startup.

| Variable                         | Default       | Description                                                                     |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                       | `development` | `development`, `production` or `test`                                           |
| `PORT`                           | `3000`        | HTTP port                                                                       |
| `LOG_LEVEL`                      | `info`        | Winston log level                                                               |
| `MONGO_URI`                      | —             | MongoDB connection string                                                       |
| `REDIS_URL`                      | —             | Redis connection URL                                                            |
| `JWT_SECRET`                     | —             | Token signing secret, at least 32 characters                                    |
| `JWT_EXPIRES_IN`                 | `1d`          | Token lifetime with a unit: `900s`, `15m`, `12h`, `1d`                          |
| `BCRYPT_SALT_ROUNDS`             | `10`          | bcrypt cost, from 4 to 15                                                       |
| `AUTH_CONTEXT_CACHE_TTL_SECONDS` | `60`          | How long a user's role and account state stay cached in Redis                   |
| `LOGIN_MAX_CONSECUTIVE_FAILS`    | `5`           | Failed sign-ins in a row that lock an email and IP pair                         |
| `LOGIN_BLOCK_DURATION_SECONDS`   | `900`         | How long that lock lasts                                                        |
| `LOGIN_MAX_FAILS_PER_IP_PER_DAY` | `100`         | Failed sign-ins one IP may make per day, across all emails                      |
| `CORS_ORIGINS`                   | empty         | Allowed origins, comma-separated; empty allows any in development, none in prod |
| `TRUST_PROXY`                    | `false`       | Number of proxies in front of the app; required in production                   |
| `RATE_LIMIT_POINTS`              | `100`         | Requests allowed per client and window                                          |
| `RATE_LIMIT_DURATION_SECONDS`    | `60`          | Rate limit window                                                               |
| `USER_DELETION_RETENTION_DAYS`   | `30`          | Days before a deleted account is purged for good                                |
| `SHUTDOWN_TIMEOUT_MS`            | `8000`        | How long shutdown may take before the process exits anyway                      |
| `WORKERS_ENABLED`                | `true`        | `false` on instances that only serve HTTP; jobs then run on other instances     |

<br />

## Database Management

### Migrations

Migrations change data that already exists: backfills, renames, index drops. They run as a deploy
step before the new version starts, never at app startup:

```bash
npm run migrate          # from source
npm run migrate:prod     # from the build (dist/)
```

A run takes a lock, so two deploys cannot apply the same migration twice, applies pending migrations
in file name order and records each one in the `migrations` collection. Then it builds the indexes
the schemas declare. Index builds only add; dropping an index takes a migration of its own.

Create a migration from the template:

```bash
npm run migration:create backfill-user-locale
# Creates src/database/migrations/20261105120000-backfill-user-locale.ts
```

A migration exports `up({ db, logger })`. It works on collections through `db` rather than models,
should be safe to run again, and is forward-only: a mistake is fixed by a new migration. See
[`src/database/migrations/README.md`](src/database/migrations/README.md) for the details.

### Seeders

Replace every user with development data:

```bash
npm run seed
```

This creates the admin `admin@example.com` and ten users (`user1@example.com` onwards) from a fixed
faker seed, so every run yields the same accounts. They all sign in with `Password123!`. Seeding
deletes every user first and refuses to run in production.

<br />

## Project Structure

Tests live next to the code they cover, in `__tests__` folders.

```
src/
├── app.ts                           # Entry point: startup, signals, graceful shutdown
├── config/                          # Zod-validated environment config
├── core/
│   ├── errors/                      # CustomError and its subclasses
│   ├── loaders/                     # MongoDB, Redis, jobs and Express, started in order
│   ├── middleware/
│   │   ├── auth/                    # authenticate (JWT + cached auth context), authorize (roles)
│   │   ├── error-handler.ts         # One JSON error contract for every failure
│   │   ├── rate-limiter.ts          # Redis-backed rate limiting with an in-memory fallback
│   │   ├── request-context.ts       # AsyncLocalStorage: trace id, IP and user per request
│   │   ├── upload.ts                # Multer uploads with content-based image checks
│   │   └── validate.ts              # Zod validation of body, params and query
│   ├── types/                       # Shared and Express types
│   ├── http-server.ts               # listen() and a graceful close
│   └── shutdown.ts                  # Shutdown hooks, run in reverse order
├── database/
│   ├── migrations/                  # Migration runner, CLI and migrations
│   ├── plugins/                     # Soft delete and audit log plugins
│   └── seeders/                     # Development seed data
├── jobs/
│   ├── queue-factory.ts             # Queues and workers with defaults and trace propagation
│   ├── index.ts                     # Starts this instance's workers
│   └── cleanup/                     # Delayed user purge, its worker and the daily scan
├── lib/
│   ├── cache.ts                     # Cache-aside over Redis, with single-flight loading
│   ├── logger.ts                    # Winston: JSON in production, readable in development
│   ├── redis.ts                     # ioredis clients, one per role
│   └── storage.ts                   # Avatar file storage
├── modules/
│   ├── health/                      # /health, /health/ready and /health/live
│   └── user/                        # Routes, controller, service, model and validators
│       ├── login-protection.ts      # Brute-force protection for sign-in
│       ├── password.ts              # bcrypt hashing and timing-safe checks
│       ├── user.auth-context.ts     # Redis-cached role and account state
│       └── user.tokens.ts           # Token issuing
├── scripts/                         # Migration scaffold
├── test/                            # Test setup: in-memory MongoDB, Redis mock
└── utils/                           # Pagination, validators, timeouts, connection helpers

locales/                             # English and Turkish messages
eslint/                              # Custom ESLint rules: no hard deletes, aggregateSafe() only
```

<br />

## API Reference

### Responses

A successful response carries `data`, `meta` for lists, and a localized `message` for changes. Reads
answer with data alone; sign-in has a message only when it restored a deleted account.

```json
{
  "data": [{ "email": "ada@example.com" }],
  "meta": { "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
}
```

Errors follow one contract, described under
[Structured Error Responses](#structured-error-responses).

### Authentication

| Method | Endpoint                | Description                                                  | Auth |
| ------ | ----------------------- | ------------------------------------------------------------ | ---- |
| POST   | `/api/v1/auth/register` | Register a user                                              | —    |
| POST   | `/api/v1/auth/login`    | Sign in and get a token; restores an account deleted earlier | —    |

- A token is an HS256 JWT whose `sub` is the user id; it carries no role. Each request reads the
  role and account state from a Redis-cached auth context (`AUTH_CONTEXT_CACHE_TTL_SECONDS`).
- Tokens issued before the last password change stop working, and so do the tokens of deactivated or
  deleted accounts. Each of those changes clears the cached context, so this happens at once.
- Sign-in answers an unknown email and a wrong password the same way, in the same time. After
  `LOGIN_MAX_CONSECUTIVE_FAILS` failures in a row, an email and IP pair is locked for
  `LOGIN_BLOCK_DURATION_SECONDS` (`429` with `Retry-After`). Each IP also has a daily failure
  budget.
- Passwords are 8 to 64 characters and at most 72 bytes, which is as much as bcrypt reads.

### User Management

| Method | Endpoint                    | Description                                         | Auth   |
| ------ | --------------------------- | --------------------------------------------------- | ------ |
| GET    | `/api/v1/users/me`          | Get the current user                                | Bearer |
| PATCH  | `/api/v1/users/me`          | Update the current user                             | Bearer |
| PATCH  | `/api/v1/users/me/password` | Change the password; returns a new token            | Bearer |
| PATCH  | `/api/v1/users/me/avatar`   | Update the avatar                                   | Bearer |
| DELETE | `/api/v1/users/me`          | Delete the account; purged after the retention days | Bearer |

### Admin Routes

| Method | Endpoint            | Description         | Auth         |
| ------ | ------------------- | ------------------- | ------------ |
| GET    | `/api/v1/users`     | List users by pages | Bearer+Admin |
| GET    | `/api/v1/users/:id` | Get a user by id    | Bearer+Admin |

`GET /api/v1/users` takes `page` (from 1), `limit` (1 to 100, default 20) and `sort`, a
comma-separated list of `createdAt`, `email`, `name` and `surname`, with `-` for descending order
(default `-createdAt`). `includeDeleted=true` adds deleted users and `onlyDeleted=true` lists only
them.

### Health Checks

| Method | Endpoint        | Description                       |
| ------ | --------------- | --------------------------------- |
| GET    | `/health`       | Every dependency, for inspection  |
| GET    | `/health/ready` | Readiness probe (traffic gating)  |
| GET    | `/health/live`  | Liveness probe (process restarts) |

<br />

## Architecture & Design Decisions

This section documents how **soft deletion** and **data lifecycle management** are handled in this
codebase.

## 🧩 Soft Delete Plugin (Mechanism)

The soft-delete mechanism is implemented via a **custom Mongoose plugin** developed specifically for
this project (`plugins/soft-delete.plugin.ts`). The plugin is intentionally **opt-in and
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

Every read, `countDocuments()` and `distinct()` included, is scoped to `{ deleted: false }` unless
explicitly overridden.

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
- The purge job is cancelled; if Redis cannot be reached, the job stays and skips the restored user

No special recovery endpoint is required.

### Failure Handling

Deleting an account schedules its purge in the same request. If the purge cannot be scheduled, for
example because Redis is down, the soft delete is rolled back and the request fails with a `500`, so
no account is left deleted without a purge to follow.

## Design Summary

- Soft delete is **mechanism**, not policy
- The plugin defines capabilities; domains define rules
- User deletion is conservative, verified, and recoverable
- Other models remain free to choose simpler semantics

<br />

## Resilience

### Health Checks

The service exposes health endpoints for **infrastructure-level traffic decisions** (load balancers,
Kubernetes probes) and for **basic human inspection** (dashboards, manual checks).

#### Endpoints

| Endpoint        | Purpose                                 | MongoDB      | Redis        | Status Codes |
| --------------- | --------------------------------------- | ------------ | ------------ | ------------ |
| `/health`       | Every dependency, for inspection        | **Critical** | Non-critical | 200 / 503    |
| `/health/ready` | Readiness probe (traffic gating)        | **Required** | Not checked  | 200 / 503    |
| `/health/live`  | Liveness probe (should it be restarted) | N/A          | N/A          | 200          |

`/health` answers with the overall status, uptime, memory and the state of each dependency:

```json
{
  "status": "degraded",
  "timestamp": "2026-11-05T12:00:00.000Z",
  "uptime": 3600,
  "memory": { "rss": 120, "heapUsed": 64 },
  "services": { "mongodb": "healthy", "redis": "unhealthy" }
}
```

#### Semantics

- **MongoDB** is a _critical dependency_: without it the instance is `unhealthy` (`503`), not ready,
  and takes no traffic.
- **Redis** is _non-critical_: the request path degrades without it (caching and rate limiting fall
  back, deletions fail cleanly) instead of stopping. `/health` reports `degraded` with `200`, and
  readiness ignores it, so a Redis outage does not take every instance out of rotation at once.
- **Readiness** is binary: `200` means the instance can take traffic, `503` that it must be taken
  out of rotation. During shutdown it answers `503`, so traffic drains before the process exits.
- **Liveness** checks no dependency: it only decides whether the process should be restarted, and
  stays `200` while a shutdown drains requests.

#### Timeouts & Failure Isolation

Every dependency check runs with a **1500 ms timeout** to:

- Prevent cascading failures
- Keep health endpoints responsive under partial outages

Failure details go to **structured logs** (`health.probe.failed`), not to HTTP responses.

#### Design Rationale

- Health endpoints are **machine-facing contracts**, not diagnostic APIs
- Non-critical dependencies must never take an instance out of rotation
- Detailed failure information belongs in logs and metrics, not in responses
- The model fits both **monolith** and **microservice** deployments

<br />

## Observability & Error Semantics

This project treats **observability as a first-class concern**, not an afterthought. The logging and
error-handling model is designed to support **production debugging, incident analysis, and
request-level traceability** without leaking sensitive information to clients.

The system explicitly distinguishes between **operational failures** (expected, client-driven
errors) and **system failures** (unexpected, infrastructure or programming errors).

### Request Context Propagation (Trace ID & Client IP)

Every incoming request gets a **request context** at the middleware layer, carried through the whole
request with `AsyncLocalStorage`. Background jobs run in a context of their own.

The request context contains:

- `traceId`
  - Taken from the `X-Trace-Id` or `X-Request-Id` header, or from a W3C `traceparent` header, when
    the value is well-formed (8 to 128 characters that cannot break a log line or a header)
  - Generated otherwise
  - In a background job: the trace id of the request that enqueued it, or one naming the job
- `ip`
  - Derived from `req.ip`, which honours `TRUST_PROXY`
- `userId`
  - Set once the request is authenticated; `system` for background jobs

These values are:

- Attached to **every log line** written during the request
- Recorded in **audit log** entries as the actor of a change
- Sent back to the client as the `X-Trace-Id` response header and in error bodies (`traceId`)

So a single request can be followed end to end, client-reported errors can be traced to their
source, and a change in the database can be traced to the request and the user behind it.

### Environment-Aware Logging Strategy

Logs go to **stdout** only. Collecting, rotating and retaining them is the platform's job, which
fits containers and Cloud Run.

| Aspect               | Development                                | Production                                        |
| -------------------- | ------------------------------------------ | ------------------------------------------------- |
| Format               | Colorized, one readable line               | One JSON object per line                          |
| Level field          | Winston level                              | Also `severity`, which Google Cloud Logging reads |
| Trace ID             | Logged + response header                   | Same                                              |
| Event name           | `event` field, e.g. `user.purge.completed` | Same                                              |
| Stack Traces in API  | Included for debugging                     | Never exposed                                     |
| Stack Traces in Logs | Captured for system errors                 | Same                                              |

Tests run with logging silenced.

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

- `401`, `403` and `429` are logged as `warn`: they can point at an attack
- Other `4xx` are logged as `debug`, so routine client mistakes do not flood production logs
- No stack trace
- Enriched with the trace id, the user once known, the method, the route pattern and the error code
- Client receives a meaningful, localized message

#### System Errors (`5xx`)

Unexpected failures indicating bugs or infrastructure issues.

Examples:

- Unhandled exceptions
- Programming errors
- Database or dependency failures

Behavior:

- Logged as `error` (`http.error.unexpected`)
- Full stack trace captured
- Enriched with the trace id, the user once known, the method and the route pattern
- Client receives a generic message and the trace id

This keeps the logs quiet about expected failures and gives real ones full diagnostics.

### Structured Error Responses

All API errors follow one contract:

```ts
{
  error: {
    code: string;       // stable and machine-readable, e.g. "auth.too_many_attempts"
    message: string;    // in the request's language
    details?: Array<{ field: string; message: string }>;
    traceId?: string;   // the same value as the X-Trace-Id header
    stack?: string;     // development only
  }
}
```

Guarantees:

- **No internal details leak in production**
  - Stack traces, internal error messages and implementation details are never exposed outside
    development.
  - Unexpected errors answer with a generic message that can still be traced through `traceId`.

- **Stable and predictable error shape**
  - Clients branch on `code`, never on `message`, which changes with the language.

- **Field-level validation feedback**
  - Validation failures are reported per field in `details`.
  - Unknown or disallowed fields are reported instead of being silently ignored.

- **Traceable client-facing failures**
  - Every error response can be matched to server-side logs through `traceId`.

- **Localization-safe messaging**
  - Client-facing messages are resolved through **i18next** (English and Turkish).
  - Logs keep the stable codes, so incident analysis does not depend on a language.

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

- No stack traces are exposed to end users
- All unexpected failures are logged with:
  - `traceId`
  - the user, once authenticated
  - HTTP method and route pattern
  - full stack trace
- Logs are one JSON object per line on stdout, with a `severity` that log platforms understand, and
  suitable for aggregation and alerting
- Every change to an audited document records who made it and under which trace id

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
