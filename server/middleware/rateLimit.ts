import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth.ts';

interface RateLimitBucket {
  timestamps: number[];
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

export function createUserRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, RateLimitBucket>();

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = req.user?.uid || req.ip || 'anonymous';
    const now = Date.now();
    const cutoff = now - options.windowMs;

    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

    if (bucket.timestamps.length >= options.maxRequests) {
      const oldest = bucket.timestamps[0] ?? now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + options.windowMs - now) / 1000),
      );

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');

      res.status(429).json({
        error:
          options.message ||
          `Too many AI requests. Please wait ${retryAfterSeconds} seconds and try again.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds,
      });
      return;
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);

    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, options.maxRequests - bucket.timestamps.length)),
    );

    if (buckets.size > 1000) {
      for (const [bucketKey, entry] of buckets.entries()) {
        if (entry.timestamps.every((ts) => ts <= cutoff)) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}
