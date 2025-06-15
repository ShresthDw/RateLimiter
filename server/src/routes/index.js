import { Router } from 'express';
import demoRoutes from './demoRoutes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use('/demo', demoRoutes);

export default router;