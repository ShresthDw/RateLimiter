const units = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000
};

let rules = {
  limit: 20,
  windowMs: 60 * 1000,
  window: '1m'
};

const algorithms = ['token-bucket', 'fixed-window', 'sliding-window', 'leaky-bucket'];
let activeAlgorithm = 'token-bucket';

const parseWindow = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+)\s*(ms|s|m|h)$/i);
  if (!match) return null;

  const duration = Number(match[1]) * units[match[2].toLowerCase()];
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null;
};

export const getRateLimitRules = () => ({ ...rules });

export const updateRateLimitRules = ({ limit, window }) => {
  const parsedLimit = Number(limit);
  const windowMs = parseWindow(window);

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100000) {
    throw new Error('limit must be an integer between 1 and 100000.');
  }

  if (!windowMs) {
    throw new Error('window must use a positive duration such as "30s", "1m", or "1h".');
  }

  rules = { limit: parsedLimit, windowMs, window: window.trim().toLowerCase() };
  return getRateLimitRules();
};

export const getActiveAlgorithm = () => activeAlgorithm;
export const getAlgorithms = () => algorithms;

export const updateActiveAlgorithm = (algorithm) => {
  if (!algorithms.includes(algorithm)) {
    throw new Error(`algorithm must be one of: ${algorithms.join(', ')}.`);
  }
  activeAlgorithm = algorithm;
  return activeAlgorithm;
};
