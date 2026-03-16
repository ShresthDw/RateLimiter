import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

const proxyTarget = () => process.env.STAYHUB_API?.replace(/\/$/, '');
const stayHubAuthorization = () => process.env.STAYHUB_AUTHORIZATION;

export const stayHubProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:9',
  changeOrigin: true,
  router: () => proxyTarget() || 'http://127.0.0.1:9',
  pathRewrite: { '^/api/proxy': '' },
  on: {
    proxyReq: (proxyReq, req, res) => {
      const authorization = stayHubAuthorization();
      if (authorization) proxyReq.setHeader('authorization', authorization);
      fixRequestBody(proxyReq, req, res);
    },
    error: (error, _req, res) => {
      if (!res.headersSent) res.status(502).json({ message: 'StayHub backend is unavailable.', detail: error.message });
    }
  }
});

export const requireStayHubTarget = (_req, res, next) => {
  if (!proxyTarget()) return res.status(503).json({ message: 'STAYHUB_API is not configured.' });
  return next();
};
