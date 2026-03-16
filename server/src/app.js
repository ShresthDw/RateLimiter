import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRoutes from './routes/index.js';
import adminRoutes from './routes/adminRoutes.js';

const app = express();
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDistDirectory = path.resolve(appDirectory, '../../client/dist');

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

app.use(express.static(clientDistDirectory));

app.use((req, res) => {
  if (req.accepts('html')) return res.sendFile(path.join(clientDistDirectory, 'index.html'));
  return res.status(404).json({ message: 'Route not found' });
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    message: error.message || 'Server error'
  });
});

export default app;
