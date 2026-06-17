import { getRedisStatus } from '../config/redis.js';
import { getDbStatus } from '../config/db.js';

export const getHealthData = async () => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

  const memory = process.memoryUsage();
  const [redis, mongodb] = await Promise.all([
    getRedisStatus(),
    Promise.resolve(getDbStatus())
  ]);

  return {
    status: 'healthy',
    service: 'RateLimiter Gateway API',
    uptime: uptimeFormatted,
    uptimeSeconds,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    renderDeployment: Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL),
    memory: {
      rssMb: Number((memory.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((memory.heapTotal / (1024 * 1024)).toFixed(2))
    },
    services: {
      redis,
      mongodb
    }
  };
};
