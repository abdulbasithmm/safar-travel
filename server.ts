import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createApiApp } from './server/app.ts';
import { serverEnv } from './server/config/env.ts';

async function startServer() {
  const app = createApiApp();

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

  app.listen(serverEnv.port, '0.0.0.0', () => {
    console.log(
      `SAFAR server listening on http://0.0.0.0:${serverEnv.port} (${serverEnv.nodeEnv})`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start SAFAR server:', err);
  process.exit(1);
});
