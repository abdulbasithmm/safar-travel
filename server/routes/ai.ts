import { Router } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { createUserRateLimiter } from '../middleware/rateLimit.ts';
import { getTravelPlannerAIProvider } from '../services/aiProvider.ts';
import type { ChatHistoryTurn, SupportedLanguage } from '../services/aiProvider.ts';

export const aiRouter = Router();

const aiChatRateLimiter = createUserRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
});

function sanitizeHistory(rawHistory: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const sanitized: ChatHistoryTurn[] = [];
  for (const entry of rawHistory.slice(-20)) {
    if (!entry || typeof entry !== 'object') continue;
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (
      (role === 'user' || role === 'assistant') &&
      typeof content === 'string' &&
      content.trim().length > 0
    ) {
      sanitized.push({
        role,
        content: content.trim().slice(0, 4000),
      });
    }
  }
  return sanitized;
}

aiRouter.post(
  '/chat',
  requireAuth,
  aiChatRateLimiter,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const message =
        typeof req.body?.message === 'string' ? req.body.message.trim() : '';

      if (!message) {
        res.status(400).json({
          error: 'Please enter a message to chat with SAFAR AI.',
          code: 'INVALID_MESSAGE',
        });
        return;
      }

      if (message.length > 4000) {
        res.status(400).json({
          error: 'Message exceeds the 4,000 character limit.',
          code: 'MESSAGE_TOO_LONG',
        });
        return;
      }

      const rawLanguage = req.body?.language;
      const language: SupportedLanguage =
        rawLanguage === 'ml' || rawLanguage === 'en' ? rawLanguage : 'auto';

      const previousResponseId =
        typeof req.body?.previousResponseId === 'string' &&
        /^[a-zA-Z0-9_\-]{4,128}$/.test(req.body.previousResponseId.trim())
          ? req.body.previousResponseId.trim()
          : undefined;

      const tripContext =
        typeof req.body?.tripContext === 'string'
          ? req.body.tripContext.trim().slice(0, 3000)
          : undefined;

      const history = sanitizeHistory(req.body?.history);
      const provider = getTravelPlannerAIProvider();

      const result = await provider.chat({
        message,
        userId: req.user!.uid,
        history,
        previousResponseId,
        language,
        tripContext,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);
