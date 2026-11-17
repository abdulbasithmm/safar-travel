import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { serverEnv } from './server/config/env.ts';
import { aiRouter } from './server/routes/ai.ts';
import { healthRouter } from './server/routes/health.ts';
import { photosRouter } from './server/routes/photos.ts';
import { tripsRouter } from './server/routes/trips.ts';
import { AIServiceError } from './server/services/aiProvider.ts';
import { PhotoServiceError } from './server/services/photoProvider.ts';

async function startServer() {
  const app = express();

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

  if (!serverEnv.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }

    if (err instanceof AIServiceError || err instanceof PhotoServiceError) {
      const safeStatus =
        err.statusCode === 502 ||
        err.statusCode === 503 ||
        err.statusCode === 504
          ? 424
          : err.statusCode;

      console.error('[API AIServiceError]', {
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

  app.listen(serverEnv.port, '0.0.0.0', () => {
    console.log(
      `Wandor server listening on http://0.0.0.0:${serverEnv.port} (${serverEnv.nodeEnv})`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start Wandor server:', err);
  process.exit(1);
});
