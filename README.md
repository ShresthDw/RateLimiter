# MERN Token Bucket Rate Limiter

A small MERN-style demo that protects Express API routes with an in-memory token bucket rate limiter and visualizes the current allowance in a React interface.

## Features

- Token bucket middleware keyed by client IP address
- `GET /api/data` protected by a 20-token-per-minute bucket
- Continuous token refill (one token every three seconds)
- `429 Too Many Requests` responses with rate-limit headers and retry time
- Optional Redis storage for atomic, shared token buckets across API instances
- React dashboard for API calls, allowed/blocked decisions, active users, latency, and current bucket
- Admin configuration panel that applies a new limit and refill window immediately
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
MONGODB_URI=mongodb://127.0.0.1:27017/rate-limiter
REDIS_URI=redis://127.0.0.1:6379
PORT=5050
```

`MONGODB_URI` and `REDIS_URI` are optional. Without Redis, the limiter uses a process-local in-memory bucket; with Redis, each request uses an atomic Redis script so multiple server instances share the same bucket.

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
| `GET` | `/api/data` | The Phase 1 protected endpoint. Starts at 20 tokens and returns `429` when empty. |
| `GET` | `/api/demo/status` | Returns the current demo bucket state for the requesting IP. |
| `GET` | `/api/demo/ping` | Consumes a demo token and returns the remaining allowance. |
| `GET` | `/api/dashboard` | Returns dashboard metrics and the current rule. |
| `GET` | `/admin/rules` | Returns the active rate-limit rule. |
| `POST` | `/admin/rules` | Updates the active rule; body example: `{ "limit": 100, "window": "1m" }`. |

`/api/demo/ping` has an additional bucket of 20 tokens per minute. A successful response includes `limit`, `remaining`, and `resetTime` in its JSON body.

Each limited response sets these headers:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

When a bucket has no token available, the API responds with HTTP `429` and a JSON `retryAfter` value in seconds.

## How the token bucket works

Every client starts with a full bucket. Each accepted request spends one token. Tokens refill continuously at the configured rate, up to the bucket capacity. This allows short bursts while preventing sustained traffic from exhausting the service.

Without `REDIS_URI`, buckets live in a process-local `Map` and reset when the server restarts. When `REDIS_URI` is configured, the project switches to Redis automatically. Bucket fields (`tokens` and `lastRefill`) are stored together and updated atomically, so Server A, B, and C make the same allow/block decision. The dashboard counters and administrator rule are intentionally in-memory demo state; secure and persist them before production use.

## Project structure

```text
client/                         React + Vite dashboard
  src/App.jsx                   Rate-limit UI
server/
  src/middleware/tokenBucketLimiter.js  Token bucket implementation
  src/routes/demoRoutes.js      Demo and status endpoints
  src/models/RequestLog.js      Optional MongoDB request log model
```
