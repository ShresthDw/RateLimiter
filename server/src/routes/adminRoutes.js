import { Router } from 'express';
import { getActiveAlgorithm, getAlgorithms, getRateLimitRules, updateActiveAlgorithm, updateRateLimitRules } from '../config/rateLimitRules.js';
import { resetMetrics } from '../services/metrics.js';

const router = Router();
const getAdminKey = () => process.env.ADMIN_KEY || 'admin123';

const requireAdmin = (req, res, next) => {
  const authHeader = req.headers['x-admin-key'] || req.headers['authorization']?.replace(/^Bearer /, '');
  if (!authHeader || authHeader !== getAdminKey()) {
    return res.status(403).json({
      message: 'Admin access required. Please enter the admin password to modify policies or reset metrics.'
    });
  }
  return next();
};

router.post('/verify', (req, res) => {
  const key = req.body?.key || req.headers['x-admin-key'];
  if (key && key === getAdminKey()) {
    return res.json({ success: true, message: 'Admin authentication successful.' });
  }
  return res.status(401).json({ success: false, message: 'Invalid admin password.' });
});

router.get('/rules', (_req, res) => {
  res.json({ ...getRateLimitRules(), activeAlgorithm: getActiveAlgorithm(), algorithms: getAlgorithms() });
});

router.post('/rules', requireAdmin, (req, res, next) => {
  try {
    const rules = updateRateLimitRules(req.body);
    res.json({ message: 'Rate-limit rules updated.', ...rules });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
});

router.post('/algorithm', requireAdmin, (req, res, next) => {
  try {
    const activeAlgorithm = updateActiveAlgorithm(req.body.algorithm);
    res.json({ message: 'Rate-limit algorithm updated.', activeAlgorithm });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
});

router.post('/reset', requireAdmin, (_req, res) => {
  const fresh = resetMetrics();
  res.json({ message: 'Metrics reset successfully.', metrics: fresh });
});

export default router;
