import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from './config/db.js';
import { initRedis } from './config/redis.js';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, '../.env') });

const { default: app } = await import('./app.js');

const port = process.env.PORT || 5000;

await connectDB();
await initRedis();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
