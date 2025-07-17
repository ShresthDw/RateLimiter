# MERN Token Bucket Rate Limiter

A small MERN-style demo that protects Express API routes with an in-memory token bucket rate limiter and visualizes the current allowance in a React interface.

## Features

- Token bucket middleware keyed by client IP address
- Global API allowance of 100 requests per 15 minutes
- Demo endpoint allowance of 20 requests per minute
- `429 Too Many Requests` responses with rate-limit headers and retry time
- React dashboard that refreshes the bucket status every three seconds
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
PORT=5000
```

`MONGODB_URI` is optional. Without it, the server starts normally and skips request logging.

Start the client and server together:

```bash
npm run dev
```

Then open the Vite URL shown in the terminal (normally `http://localhost:5173`). The client proxies `/api` requests to `http://localhost:5000`.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the client and server in development mode. |
| `npm run build` | Build the production client bundle. |
| `npm start` | Start the Express server. |
| `npm run install:all` | Install dependencies for both workspaces. |

## API

All API routes are protected by the global token bucket (100 tokens, refilled continuously over 15 minutes).

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Returns `{ "status": "ok" }`. |
| `GET` | `/api/demo/status` | Returns the current demo bucket state for the requesting IP. |
| `GET` | `/api/demo/ping` | Consumes a demo token and returns the remaining allowance. |

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

The current implementation stores buckets in a process-local `Map`, so limits reset when the server restarts and are not shared across multiple server instances. For production, replace this store with a shared backend such as Redis.

## Project structure

```text
client/                         React + Vite dashboard
  src/App.jsx                   Rate-limit UI
server/
  src/middleware/tokenBucketLimiter.js  Token bucket implementation
  src/routes/demoRoutes.js      Demo and status endpoints
  src/models/RequestLog.js      Optional MongoDB request log model
```
