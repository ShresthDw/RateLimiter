import { Router } from 'express';
import { getActiveAlgorithm, getAlgorithms, getRateLimitRules, updateActiveAlgorithm, updateRateLimitRules } from '../config/rateLimitRules.js';

const router = Router();

router.get('/rules', (_req, res) => {
  res.json({ ...getRateLimitRules(), activeAlgorithm: getActiveAlgorithm(), algorithms: getAlgorithms() });
});

router.post('/rules', (req, res, next) => {
  try {
    const rules = updateRateLimitRules(req.body);
    res.json({ message: 'Rate-limit rules updated.', ...rules });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
});

router.post('/algorithm', (req, res, next) => {
  try {
    const activeAlgorithm = updateActiveAlgorithm(req.body.algorithm);
    res.json({ message: 'Rate-limit algorithm updated.', activeAlgorithm });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
});

export default router;
