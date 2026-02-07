import { Router } from 'express';
import { getRateLimitRules, updateRateLimitRules } from '../config/rateLimitRules.js';

const router = Router();

router.get('/rules', (_req, res) => {
  res.json(getRateLimitRules());
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

export default router;
