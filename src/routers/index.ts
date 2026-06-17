import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { requestContext } from '../utils/logger.js';
import { analyticsRouter } from './analytics.js';
import { userKeyRouter } from './user-key.js';
import { savedResultsRouter } from './saved-results.js';
import { sourcesRouter } from './sources.js';
import { historyRouter } from './history.js';
import { cacheRouter } from './cache.js';

const PUBLIC_PATHS = ['/provider', '/meta'] as const;

function requestIdMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  requestContext.run({ requestId: randomUUID() }, next);
}

function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = config.server.apiKey;
  if (!key) { next(); return; }
  const provided = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'];
  if (provided !== key) {
    res.status(401).json({ error: 'Invalid or missing x-api-key header.' });
    return;
  }
  next();
}

export const apiRouter = Router();

apiRouter.use(requestIdMiddleware);
// User-key routes are public — no server auth required
apiRouter.use(userKeyRouter);
apiRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.some(p => req.path === p)) { next(); return; }
  apiKeyMiddleware(req, res, next);
});

apiRouter.use(analyticsRouter);
apiRouter.use(savedResultsRouter);
apiRouter.use(sourcesRouter);
apiRouter.use(historyRouter);
apiRouter.use(cacheRouter);
