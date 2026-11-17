import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { serverEnv } from './config/env.ts';
import { aiRouter } from './routes/ai.ts';
import { healthRouter } from './routes/health.ts';
import { photosRouter } from './routes/photos.ts';
import { tripsRouter } from './routes/trips.ts';
import { AIServiceError } from './services/aiProvider.ts';
import { PhotoServiceError } from './services/photoProvider.ts';

export function createApiApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api/health', healthRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/trips', tripsRouter);
  app.use('/api/photos', photosRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'API route not found.',
      code: 'NOT_FOUND',
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }

    if (
      err &&
      typeof err === 'object' &&
      'type' in err &&
      (err as { type?: unknown }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({
        error: 'Invalid JSON request body sent to API.',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    if (err instanceof AIServiceError || err instanceof PhotoServiceError) {
      const safeStatus =
        err.statusCode === 502 ||
        err.statusCode === 503 ||
        err.statusCode === 504
          ? 424
          : err.statusCode;

      console.error('[API ServiceError]', {
        method: req.method,
        path: req.originalUrl,
        statusCode: safeStatus,
        code: err.code,
        message: err.message.replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***'),
      });

      if (err.retryAfterSeconds) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      res.status(safeStatus).json({
        error: err.message,
        code: err.code,
        ...(err.retryAfterSeconds
          ? { retryAfterSeconds: err.retryAfterSeconds }
          : {}),
      });
      return;
    }

    const rawMessage =
      err instanceof Error ? err.message : 'An unexpected server error occurred.';
    const safeMessage = rawMessage.replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***');
    console.error('[API UnhandledError]', {
      method: req.method,
      path: req.originalUrl,
      message: safeMessage,
    });

    res.status(500).json({
      error: serverEnv.isProduction
        ? 'Internal server error. Please try again later.'
        : safeMessage,
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  return app;
}
