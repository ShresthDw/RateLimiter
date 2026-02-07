import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';
import { connectDB } from './config/db.js';
import { initRedis } from './config/redis.js';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, '../.env') });

const port = process.env.PORT || 5000;

await connectDB();
await initRedis();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
