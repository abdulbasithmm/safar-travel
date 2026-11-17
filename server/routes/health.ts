import { Router } from 'express';
import { serverEnv } from '../config/env.ts';
import { isOpenAIConfigured } from '../services/aiProvider.ts';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const openAiConfigured = isOpenAIConfigured();
  const mapsConfigured = Boolean(
    process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim(),
  );

  const photoProviders = {
    unsplash: Boolean(serverEnv.unsplashAccessKey),
    pexels: Boolean(serverEnv.pexelsApiKey),
    wikimedia: true,
  };

  const primaryPhotoProvider = photoProviders.unsplash
    ? 'unsplash'
    : photoProviders.pexels
      ? 'pexels'
      : 'wikimedia';

  res.json({
    ok: true,
    service: 'wandor-api',
    firebaseConfigured: Boolean(serverEnv.firebaseProjectId),
    mapsConfigured,
    aiProvider: openAiConfigured ? 'openai' : 'unconfigured',
    openAiConfigured,
    openAiModel: serverEnv.openAiModel,
    primaryPhotoProvider,
    photoProviders,
    timestamp: new Date().toISOString(),
  });
});
