import { Router } from 'express';
import { createUserRateLimiter } from '../middleware/rateLimit.ts';
import {
  getFeaturedDestinationCards,
  normalizeCategory,
  normalizePhotoQuery,
  searchDestinationPhotography,
  validatePhotoQuery,
} from '../services/photoProvider.ts';

export const photosRouter = Router();

const photoRateLimiter = createUserRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Too many destination photo requests. Please wait a moment and try again.',
});

photosRouter.get('/search', photoRateLimiter, async (req, res, next) => {
  try {
    const query = validatePhotoQuery(req.query.q);
    const context = normalizePhotoQuery(req.query.context).slice(0, 120);
    const category = normalizeCategory(req.query.category);
    const rawLimit = Number(req.query.limit ?? 6);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.round(rawLimit), 1), 12)
      : 6;

    const result = await searchDestinationPhotography({
      query,
      context,
      category,
      limit,
    });

    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=1800');
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

photosRouter.get('/featured', photoRateLimiter, async (_req, res, next) => {
  try {
    const destinations = await getFeaturedDestinationCards();
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=1800');
    res.status(200).json({ destinations });
  } catch (error) {
    next(error);
  }
});
