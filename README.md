# MERN Token Bucket Rate Limiter

A MERN-style API gateway that rate-limits requests before proxying them to a deployed StayHub backend, with a React dashboard for gateway metrics and rules.

## Features

- Token bucket middleware keyed by client IP address
- `GET /api/proxy/*` protected by the active rate limiter and forwarded to StayHub
- Continuous token refill (one token every three seconds)
- `429 Too Many Requests` responses with rate-limit headers and retry time
- Optional Redis storage for atomic, shared token buckets across API instances
- React dashboard for API calls, allowed/blocked decisions, active users, latency, and current bucket
- Admin configuration panel that applies a new limit and refill window immediately
- Algorithm selector for Token Bucket, Fixed Window, Sliding Window, and Leaky Bucket
- Per-algorithm comparison metrics for allowed/blocked requests, decision latency, and estimated memory use
- MongoDB decision logs containing IP, endpoint, algorithm, allow/block decision, remaining tokens, and time
- Optional StayHub reverse proxy configured with `STAYHUB_API`
- Optional MongoDB request logging with automatic 24-hour expiry

## Tech stack

- React 18 and Vite
- Node.js and Express
- MongoDB/Mongoose (optional)

## Prerequisites

- Node.js 18 or later
- npm
- MongoDB only if you want to persist request logs

## Getting started

Install all workspace dependencies from the project root:

```bash
npm install
```

Optionally create `server/.env` to enable MongoDB logging:

```env
MONGO_URI=mongodb://127.0.0.1:27017/rate-limiter
REDIS_URL=redis://127.0.0.1:6379
PORT=5050
STAYHUB_API=https://your-stayhub-backend.example.com
```

`MONGO_URI`, `REDIS_URL`, and `STAYHUB_API` are optional. `MONGODB_URI` and `REDIS_URI` remain supported as backwards-compatible aliases. Without Redis, the limiter uses a process-local in-memory bucket; with Redis, each request uses an atomic Redis script so multiple server instances share the same bucket.

The gateway forwards StayHub's incoming authentication headers and cookies unchanged. Do not configure a fixed user ID in the gateway: real visitors must retain their own identity.

Start the client and server together:

```bash
npm run dev
```

Then open the Vite URL shown in the terminal (normally `http://localhost:5173`). The client proxies `/api` requests to `http://localhost:5050`.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the client and server in development mode. |
| `npm run build` | Build the production client bundle. |
| `npm start` | Start the Express server. |
| `npm run install:all` | Install dependencies for both workspaces. |

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Returns `{ "status": "ok" }`. |
| `GET` | `/api/status` | Returns the current bucket state for the requesting IP. |
| `GET` | `/api/analytics` | Returns gateway analytics. |
| `GET` | `/api/metrics` | Returns gateway metrics. |
| `GET` | `/api/rules` | Returns the active rate-limit rule and available algorithms. |
| `POST` | `/api/rules` | Updates the active rate-limit rule. |
| `ALL` | `/api/proxy/*` | Rate-limits and forwards the path after `/api/proxy` to `STAYHUB_API`. |
| `GET` | `/api/dashboard` | Returns dashboard metrics and the current rule. |
| `GET` | `/admin/rules` | Returns the active rate-limit rule. |
| `POST` | `/admin/rules` | Updates the active rule; body example: `{ "limit": 100, "window": "1m" }`. |
| `POST` | `/admin/algorithm` | Selects the active limiter; body example: `{ "algorithm": "sliding-window" }`. |

For example, `GET /api/proxy/api/rooms` is forwarded as `GET {STAYHUB_API}/api/rooms` after the active limiter allows it. This public endpoint is used by the dashboard demo, so no StayHub identity is required. A missing `STAYHUB_API` returns `503` rather than forwarding to an invalid target.

Each limited response sets these headers:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

When a bucket has no token available, the API responds with HTTP `429` and a JSON `retryAfter` value in seconds.

## Algorithm comparison and logging

Use the dashboard dropdown (or `POST /admin/algorithm`) to switch between `token-bucket`, `fixed-window`, `sliding-window`, and `leaky-bucket`. The comparison table collects results for requests made while each algorithm is selected. Token Bucket uses Redis when `REDIS_URI` is set; the other comparison implementations are in-memory for demonstration.

When `MONGODB_URI` is set, every request that reaches a protected endpoint is stored in the `requestlogs` collection with `ip`, `endpoint`, `algorithm`, `allowed`, `remainingTokens`, and `time`. Logs expire automatically after 24 hours.

## How the token bucket works

Every client starts with a full bucket. Each accepted request spends one token. Tokens refill continuously at the configured rate, up to the bucket capacity. This allows short bursts while preventing sustained traffic from exhausting the service.

Without `REDIS_URI`, buckets live in a process-local `Map` and reset when the server restarts. When `REDIS_URI` is configured, the project switches to Redis automatically. Bucket fields (`tokens` and `lastRefill`) are stored together and updated atomically, so Server A, B, and C make the same allow/block decision. The dashboard counters and administrator rule are intentionally in-memory demo state; secure and persist them before production use.

## Project structure

```text
client/                         React + Vite dashboard
  src/App.jsx                   Rate-limit UI
server/
  src/middleware/tokenBucketLimiter.js  Token bucket implementation
  src/proxy/proxy.js                   StayHub reverse proxy
  src/routes/index.js                  Health, analytics, rules, and proxy routes
  src/models/RequestLog.js      Optional MongoDB request log model
```
