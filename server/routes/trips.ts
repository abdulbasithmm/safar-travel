import { Router } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { createUserRateLimiter } from '../middleware/rateLimit.ts';
import { getTravelPlannerAIProvider } from '../services/aiProvider.ts';
import type {
  CurrencyCode,
  SupportedLanguage,
  TravelStyle,
} from '../services/aiProvider.ts';

export const tripsRouter = Router();

const tripPlanRateLimiter = createUserRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
});

const VALID_CURRENCIES: CurrencyCode[] = ['INR', 'USD', 'EUR'];
const VALID_STYLES: TravelStyle[] = [
  'family',
  'solo',
  'couple',
  'adventure',
  'budget',
  'luxury',
];

tripsRouter.get('/session', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    authenticated: true,
    user: req.user,
  });
});

tripsRouter.post(
  '/plan',
  requireAuth,
  tripPlanRateLimiter,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const destination =
        typeof body.destination === 'string' ? body.destination.trim() : '';
      const rawPrompt =
        typeof body.prompt === 'string' ? body.prompt.trim() : '';

      if (!destination && !rawPrompt) {
        res.status(400).json({
          error: 'Please specify a destination or travel prompt.',
          code: 'INVALID_DESTINATION',
        });
        return;
      }

      if (destination.length > 200 || rawPrompt.length > 2000) {
        res.status(400).json({
          error: 'Destination or prompt exceeds maximum allowed length.',
          code: 'INPUT_TOO_LONG',
        });
        return;
      }

      const startingLocation =
        typeof body.startingLocation === 'string'
          ? body.startingLocation.trim().slice(0, 200)
          : '';
      const departureDate =
        typeof body.departureDate === 'string'
          ? body.departureDate.trim().slice(0, 20)
          : '';
      const returnDate =
        typeof body.returnDate === 'string'
          ? body.returnDate.trim().slice(0, 20)
          : '';

      if (
        departureDate &&
        returnDate &&
        /^\d{4}-\d{2}-\d{2}$/.test(departureDate) &&
        /^\d{4}-\d{2}-\d{2}$/.test(returnDate) &&
        returnDate < departureDate
      ) {
        res.status(400).json({
          error: 'Return date cannot be earlier than departure date.',
          code: 'INVALID_DATE_RANGE',
        });
        return;
      }

      const rawTravelers = Number(body.travelers ?? 2);
      const travelers = Number.isFinite(rawTravelers)
        ? Math.min(Math.max(Math.round(rawTravelers), 1), 30)
        : 2;

      const rawDuration = Number(body.durationDays ?? 3);
      const durationDays = Number.isFinite(rawDuration)
        ? Math.min(Math.max(Math.round(rawDuration), 1), 30)
        : 3;

      const rawBudget = Number(body.budgetAmount ?? 0);
      const budgetAmount =
        Number.isFinite(rawBudget) && rawBudget >= 0
          ? Math.round(rawBudget * 100) / 100
          : 0;

      const currency: CurrencyCode = VALID_CURRENCIES.includes(
        body.currency as CurrencyCode,
      )
        ? (body.currency as CurrencyCode)
        : 'INR';

      const travelStyle: TravelStyle = VALID_STYLES.includes(
        body.travelStyle as TravelStyle,
      )
        ? (body.travelStyle as TravelStyle)
        : 'family';

      const interests = Array.isArray(body.interests)
        ? body.interests
            .filter(
              (item): item is string =>
                typeof item === 'string' && item.trim().length > 0,
            )
            .slice(0, 15)
            .map((item) => item.trim().slice(0, 60))
        : [];

      const rawLanguage = body.language;
      const language: SupportedLanguage =
        rawLanguage === 'ml' || rawLanguage === 'en' ? rawLanguage : 'auto';

      const provider = getTravelPlannerAIProvider();
      const result = await provider.generateFullItinerary({
        destination: destination || 'Requested Destination',
        startingLocation,
        departureDate,
        returnDate,
        travelers,
        durationDays,
        budgetAmount,
        currency,
        travelStyle,
        interests,
        prompt: rawPrompt,
        language,
        userId: req.user!.uid,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);
