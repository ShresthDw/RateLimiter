import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from './config/db.js';
import { initRedis } from './config/redis.js';

// Catch unhandled errors so unexpected exceptions don't crash the server process
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, '../.env') });

const { default: app } = await import('./app.js');

const port = process.env.PORT || 5000;

await connectDB();
await initRedis();

const server = app.listen(port, () => {
  console.log(`===========================================`);
  console.log(`🚀 RateLimiter Gateway running on port ${port}`);
  console.log(`🩺 Health API: http://localhost:${port}/health`);
  console.log(`🩺 API Health: http://localhost:${port}/api/health`);
  console.log(`===========================================`);
  
  // Start Keep-Alive pinger to prevent Render free-tier spin down (every 13 minutes)
  startKeepAlive();
});

const startKeepAlive = () => {
  const serviceUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  if (!serviceUrl) {
    console.log('ℹ️  Keep-Alive: No RENDER_EXTERNAL_URL or SERVER_URL configured (local mode).');
    return;
  }

  const healthUrl = `${serviceUrl.replace(/\/$/, '')}/health`;
  const PING_INTERVAL_MS = 13 * 60 * 1000; // 13 minutes (Render sleeps at 15 mins)

  console.log(`🔄 Keep-Alive activated for ${healthUrl} (interval: 13m)`);

  setInterval(async () => {
    try {
      const response = await fetch(healthUrl);
      console.log(`[Keep-Alive] Pinged ${healthUrl} - Status: ${response.status} (${new Date().toLocaleTimeString()})`);
    } catch (err) {
      console.warn(`[Keep-Alive] Ping failed: ${err.message}`);
    }
  }, PING_INTERVAL_MS);
};
