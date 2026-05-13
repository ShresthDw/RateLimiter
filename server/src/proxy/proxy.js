import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

const proxyTarget = () => process.env.STAYHUB_API?.replace(/\/$/, '');
const stayHubAuthorization = () => process.env.STAYHUB_AUTHORIZATION;

export const mockFallbackHandler = (req, res) => {
  const endpoint = req.originalUrl || req.path || '/api/proxy';
  let sampleData = { status: 'healthy', service: 'StayHub Core API' };

  if (endpoint.includes('room')) {
    sampleData = {
      rooms: [
        { id: 'room-101', title: 'Oceanfront Villa Suite', city: 'Miami', pricePerNight: 240, rating: 4.9 },
        { id: 'room-102', title: 'Mountain Vista Lodge', city: 'Aspen', pricePerNight: 350, rating: 4.8 },
        { id: 'room-103', title: 'Urban Skyline Studio', city: 'New York', pricePerNight: 195, rating: 4.7 }
      ]
    };
  } else if (endpoint.includes('booking')) {
    sampleData = {
      bookings: [
        { bookingId: 'BK-8831', guest: 'Sarah Jenkins', checkIn: '2026-09-15', status: 'confirmed' },
        { bookingId: 'BK-8832', guest: 'David Chen', checkIn: '2026-09-18', status: 'active' }
      ]
    };
  } else if (endpoint.includes('user') || endpoint.includes('auth')) {
    sampleData = {
      user: { id: 'usr-4412', name: 'Dev Tester', role: 'verified_traveler', tier: 'Gold' }
    };
  } else if (endpoint.includes('review')) {
    sampleData = {
      reviews: [
        { id: 'rev-01', user: 'Emma W.', comment: 'Seamless check-in, incredible view!', rating: 5 }
      ]
    };
  }

  return res.status(200).json({
    status: 'success',
    source: proxyTarget() ? 'live_or_fallback' : 'gateway_mock',
    endpoint,
    clientIp: req.headers['x-simulated-ip'] || req.headers['x-client-ip'] || req.ip,
    rateLimit: req.rateLimit,
    data: sampleData
  });
};

export const stayHubProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:9',
  changeOrigin: true,
  proxyTimeout: 3000,
  timeout: 3000,
  router: () => proxyTarget() || 'http://127.0.0.1:9',
  pathRewrite: { '^/api/proxy': '' },
  on: {
    proxyReq: (proxyReq, req, res) => {
      const authorization = stayHubAuthorization();
      if (authorization) proxyReq.setHeader('authorization', authorization);
      fixRequestBody(proxyReq, req, res);
    },
    proxyRes: (_proxyRes, req, res) => {
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    },
    error: (_error, req, res) => {
      if (!res.headersSent) {
        return mockFallbackHandler(req, res);
      }
    }
  }
});

export const requireStayHubTarget = (req, res, next) => {
  if (
    !proxyTarget() ||
    req.query.mock === 'true' ||
    req.path.startsWith('/mock') ||
    req.path.startsWith('/test') ||
    process.env.MOCK_PROXY === 'true'
  ) {
    return mockFallbackHandler(req, res);
  }
  return next();
};
