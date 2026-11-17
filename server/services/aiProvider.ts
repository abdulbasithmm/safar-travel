import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { getOpenAiApiKey, getOpenAiModel } from '../config/env.ts';

export type AIProviderId = 'openai';
export type SupportedLanguage = 'auto' | 'en' | 'ml';
export type CurrencyCode = 'INR' | 'USD' | 'EUR';
export type TravelStyle =
  | 'family'
  | 'solo'
  | 'couple'
  | 'adventure'
  | 'budget'
  | 'luxury';

export interface FullTripPlanRequest {
  destination: string;
  startingLocation: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  durationDays: number;
  budgetAmount: number;
  currency: CurrencyCode;
  travelStyle: TravelStyle;
  interests: string[];
  prompt: string;
  language: SupportedLanguage;
  userId: string;
}

export interface BudgetBreakdown {
  accommodation: number;
  food: number;
  transportation: number;
  activities: number;
  total: number;
  currency: CurrencyCode;
  disclaimer: string;
}

export interface ItineraryScheduleItem {
  time: string;
  activity: string;
  location: string;
  visitingHours: string;
  travelTimeFromPrev: string;
  estimatedCost: number;
  notes: string;
}

export interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  estimatedTravelTime: string;
  schedule: ItineraryScheduleItem[];
}

export interface AttractionItem {
  name: string;
  description: string;
  bestTimeToVisit: string;
  estimatedDuration: string;
}

export interface AccommodationItem {
  name: string;
  area: string;
  tier: string;
  approximateNightlyRange: string;
  notes: string;
}

export interface FoodItem {
  dishOrSpot: string;
  type: string;
  area: string;
  approximateCostRange: string;
  notes: string;
}

export interface StructuredTripPlan {
  destination: string;
  tripSummary: string;
  totalEstimatedBudget: number;
  currency: CurrencyCode;
  budgetBreakdown: BudgetBreakdown;
  dailyItinerary: ItineraryDay[];
  attractions: AttractionItem[];
  accommodationSuggestions: AccommodationItem[];
  foodRecommendations: FoodItem[];
  travelTips: string[];
  suggestedFollowUps: string[];
  language: 'en' | 'ml';
}

export interface FullTripPlanResponse {
  plan: StructuredTripPlan;
  responseId: string;
  model: string;
  aiProvider: AIProviderId;
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatRequest {
  message: string;
  userId: string;
  history?: ChatHistoryTurn[];
  previousResponseId?: string;
  language?: SupportedLanguage;
  tripContext?: string;
}

export interface AIChatTripDraft {
  title: string;
  destination: string;
  durationDays: number;
  summary: string;
  aiProvider: AIProviderId;
}

export interface AIChatResult {
  reply: string;
  responseId: string;
  model: string;
  language: 'en' | 'ml';
  suggestedFollowUps: string[];
  tripDraft?: AIChatTripDraft;
}

export interface TravelPlannerAIProvider {
  readonly id: AIProviderId;
  generateFullItinerary(input: FullTripPlanRequest): Promise<FullTripPlanResponse>;
  chat(input: AIChatRequest): Promise<AIChatResult>;
}

export class AIServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AIServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const CHAT_TIMEOUT_MS = 45_000;
const PLAN_TIMEOUT_MS = 120_000;

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o[1-9])/i.test(model);
}

function sanitizeSensitiveText(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[a-zA-Z0-9._\-]{12,}/gi, 'Bearer ***');
}

function stripMarkdownJsonFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function containsMalayalam(text: string): boolean {
  return /[\u0D00-\u0D7F]/.test(text);
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return Math.round(num * 100) / 100;
}

function toSafeString(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLen);
}

function addDaysToIsoDate(startDate: string, offsetDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '';
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function validateStructuredTripPlan(
  raw: unknown,
  input: FullTripPlanRequest,
  detectedLanguage: 'en' | 'ml',
): StructuredTripPlan {
  if (!raw || typeof raw !== 'object') {
    throw new AIServiceError(
      424,
      'OPENAI_INVALID_RESPONSE',
      'OpenAI returned an invalid itinerary object.',
    );
  }

  const obj = raw as Record<string, unknown>;
  const destination = toSafeString(obj.destination, 200, input.destination);
  const tripSummary = toSafeString(obj.tripSummary, 4000);

  if (!destination || !tripSummary) {
    throw new AIServiceError(
      424,
      'OPENAI_INCOMPLETE_RESPONSE',
      'OpenAI itinerary response was missing destination or tripSummary.',
    );
  }

  const rawDaily = Array.isArray(obj.dailyItinerary) ? obj.dailyItinerary : [];
  if (rawDaily.length === 0) {
    throw new AIServiceError(
      424,
      'OPENAI_INCOMPLETE_RESPONSE',
      'OpenAI itinerary response did not include dailyItinerary days.',
    );
  }

  const currency: CurrencyCode =
    obj.currency === 'USD' || obj.currency === 'EUR' || obj.currency === 'INR'
      ? obj.currency
      : input.currency;

  const rawBudget =
    obj.budgetBreakdown && typeof obj.budgetBreakdown === 'object'
      ? (obj.budgetBreakdown as Record<string, unknown>)
      : {};

  const accommodation = toSafeNumber(rawBudget.accommodation, 0);
  const food = toSafeNumber(rawBudget.food, 0);
  const transportation = toSafeNumber(rawBudget.transportation, 0);
  const activities = toSafeNumber(rawBudget.activities, 0);
  const summedBudget =
    Math.round((accommodation + food + transportation + activities) * 100) / 100;

  const rawTotal = toSafeNumber(obj.totalEstimatedBudget, summedBudget);
  const totalEstimatedBudget = summedBudget > 0 ? summedBudget : rawTotal;

  const defaultDisclaimer =
    detectedLanguage === 'ml'
      ? 'ഇത് ഏകദേശ യാത്രാ ബജറ്റ് കണക്കാണ്. ലൈവ് ഹോട്ടൽ നിരക്കുകളോ ഫ്ലൈറ്റ് ലഭ്യതയോ ഇതിൽ ഉൾപ്പെടുന്നില്ല.'
      : 'Approximate planning estimate only. Does not reflect live hotel prices or real-time flight availability.';

  const budgetBreakdown: BudgetBreakdown = {
    accommodation,
    food,
    transportation,
    activities,
    total: totalEstimatedBudget,
    currency,
    disclaimer: toSafeString(rawBudget.disclaimer, 500, defaultDisclaimer),
  };

  const dailyItinerary: ItineraryDay[] = rawDaily
    .slice(0, 30)
    .map((dayEntry, idx) => {
      const d =
        dayEntry && typeof dayEntry === 'object'
          ? (dayEntry as Record<string, unknown>)
          : {};
      const dayNumber =
        typeof d.day === 'number' && Number.isFinite(d.day) && d.day > 0
          ? Math.round(d.day)
          : idx + 1;
      const rawSchedule = Array.isArray(d.schedule) ? d.schedule : [];

      const schedule: ItineraryScheduleItem[] = rawSchedule
        .slice(0, 12)
        .map((item) => {
          const s =
            item && typeof item === 'object'
              ? (item as Record<string, unknown>)
              : {};
          return {
            time: toSafeString(s.time, 60, '09:00 AM'),
            activity: toSafeString(s.activity, 240, 'Explore destination'),
            location: toSafeString(s.location, 180, destination),
            visitingHours: toSafeString(s.visitingHours, 100, 'Daytime'),
            travelTimeFromPrev: toSafeString(
              s.travelTimeFromPrev,
              100,
              '15-30 mins',
            ),
            estimatedCost: toSafeNumber(s.estimatedCost, 0),
            notes: toSafeString(s.notes, 400),
          };
        });

      const computedDate = input.departureDate
        ? addDaysToIsoDate(input.departureDate, dayNumber - 1)
        : '';

      return {
        day: dayNumber,
        date: toSafeString(d.date, 30, computedDate),
        theme: toSafeString(d.theme, 180, `Day ${dayNumber}`),
        estimatedTravelTime: toSafeString(
          d.estimatedTravelTime,
          120,
          'Local transit',
        ),
        schedule,
      };
    });

  const rawAttractions = Array.isArray(obj.attractions) ? obj.attractions : [];
  const attractions: AttractionItem[] = rawAttractions
    .slice(0, 30)
    .map((item) => {
      const a =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return {
        name: toSafeString(a.name, 160, 'Local Highlight'),
        description: toSafeString(a.description, 500),
        bestTimeToVisit: toSafeString(a.bestTimeToVisit, 120, 'Morning'),
        estimatedDuration: toSafeString(a.estimatedDuration, 80, '1-2 hours'),
      };
    })
    .filter((a) => a.name.length > 0);

  const rawAccommodations = Array.isArray(obj.accommodationSuggestions)
    ? obj.accommodationSuggestions
    : [];
  const accommodationSuggestions: AccommodationItem[] = rawAccommodations
    .slice(0, 15)
    .map((item) => {
      const a =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return {
        name: toSafeString(a.name, 160, 'Recommended Stay Area'),
        area: toSafeString(a.area, 140, destination),
        tier: toSafeString(a.tier, 80, input.travelStyle),
        approximateNightlyRange: toSafeString(
          a.approximateNightlyRange,
          120,
          'Estimate varies by season',
        ),
        notes: toSafeString(a.notes, 400),
      };
    });

  const rawFood = Array.isArray(obj.foodRecommendations)
    ? obj.foodRecommendations
    : [];
  const foodRecommendations: FoodItem[] = rawFood
    .slice(0, 20)
    .map((item) => {
      const f =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return {
        dishOrSpot: toSafeString(f.dishOrSpot, 160, 'Local Specialty'),
        type: toSafeString(f.type, 80, 'Local Cuisine'),
        area: toSafeString(f.area, 120, destination),
        approximateCostRange: toSafeString(f.approximateCostRange, 100, 'Moderate'),
        notes: toSafeString(f.notes, 350),
      };
    });

  const travelTips = (Array.isArray(obj.travelTips) ? obj.travelTips : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 20)
    .map((item) => item.trim().slice(0, 350));

  const suggestedFollowUps = (
    Array.isArray(obj.suggestedFollowUps) ? obj.suggestedFollowUps : []
  )
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 10)
    .map((item) => item.trim().slice(0, 180));

  const language: 'en' | 'ml' =
    obj.language === 'ml' || (!obj.language && detectedLanguage === 'ml')
      ? 'ml'
      : 'en';

  return {
    destination,
    tripSummary,
    totalEstimatedBudget,
    currency,
    budgetBreakdown,
    dailyItinerary,
    attractions,
    accommodationSuggestions,
    foodRecommendations,
    travelTips,
    suggestedFollowUps,
    language,
  };
}

function logOpenAIError(
  operation: 'plan' | 'chat',
  model: string,
  error: unknown,
): void {
  if (error instanceof AIServiceError) {
    console.error(`[OpenAI:${operation}] AIServiceError`, {
      model,
      statusCode: error.statusCode,
      code: error.code,
      message: sanitizeSensitiveText(error.message),
    });
    return;
  }

  if (error instanceof OpenAI.APIError) {
    console.error(`[OpenAI:${operation}] APIError`, {
      model,
      name: error.name,
      status: error.status,
      code: (error as { code?: unknown }).code,
      type: (error as { type?: unknown }).type,
      param: (error as { param?: unknown }).param,
      requestID: error.requestID,
      message: sanitizeSensitiveText(error.message),
    });
    return;
  }

  console.error(`[OpenAI:${operation}] Unexpected error`, {
    model,
    name: error instanceof Error ? error.name : typeof error,
    message: sanitizeSensitiveText(
      error instanceof Error ? error.message : String(error),
    ),
  });
}

function mapOpenAIError(
  error: unknown,
  operation: 'plan' | 'chat',
  model: string,
): AIServiceError {
  logOpenAIError(operation, model, error);

  if (error instanceof AIServiceError) {
    return error;
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return new AIServiceError(
      424,
      'OPENAI_INVALID_API_KEY',
      'OpenAI authentication failed. Please check that the server OPENAI_API_KEY secret is valid.',
    );
  }

  if (error instanceof OpenAI.PermissionDeniedError) {
    return new AIServiceError(
      424,
      'OPENAI_PERMISSION_DENIED',
      'OpenAI rejected access for the configured model or project.',
    );
  }

  if (error instanceof OpenAI.NotFoundError) {
    return new AIServiceError(
      424,
      'OPENAI_MODEL_NOT_FOUND',
      `Configured OpenAI model (${model}) is unavailable for this API project.`,
    );
  }

  if (error instanceof OpenAI.RateLimitError) {
    return new AIServiceError(
      429,
      'OPENAI_RATE_LIMITED',
      'OpenAI rate limit or quota exceeded. Please wait a moment and try again.',
      30,
    );
  }

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new AIServiceError(
      408,
      'OPENAI_TIMEOUT',
      'The AI travel planner timed out while waiting for OpenAI. Please retry.',
    );
  }

  if (error instanceof OpenAI.BadRequestError) {
    return new AIServiceError(
      400,
      'OPENAI_BAD_REQUEST',
      sanitizeSensitiveText(
        error.message || 'Invalid request parameters sent to OpenAI.',
      ),
    );
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new AIServiceError(
      424,
      'OPENAI_CONNECTION_ERROR',
      'Unable to reach OpenAI right now. Please try again shortly.',
    );
  }

  if (error instanceof OpenAI.APIError) {
    const status = error.status && error.status >= 400 ? error.status : 424;
    if (status === 401) {
      return new AIServiceError(
        424,
        'OPENAI_INVALID_API_KEY',
        'OpenAI authentication failed. Please check that the server OPENAI_API_KEY secret is valid.',
      );
    }
    const safeStatus =
      status >= 500 || status === 403 ? 424 : status;
    return new AIServiceError(
      safeStatus,
      'OPENAI_UPSTREAM_ERROR',
      'OpenAI returned an upstream error. Please try again.',
    );
  }

  return new AIServiceError(
    424,
    'OPENAI_UNKNOWN_ERROR',
    'Unexpected error communicating with OpenAI.',
  );
}

export class OpenAITravelPlannerProvider implements TravelPlannerAIProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new AIServiceError(
        500,
        'OPENAI_NOT_CONFIGURED',
        'OPENAI_API_KEY is not configured in server-side environment secrets.',
      );
    }

    this.client = new OpenAI({
      apiKey,
      timeout: PLAN_TIMEOUT_MS,
      maxRetries: 1,
    });
    this.model = model;
  }

  async generateFullItinerary(
    input: FullTripPlanRequest,
  ): Promise<FullTripPlanResponse> {
    const detectedLanguage: 'en' | 'ml' =
      input.language === 'ml' ||
      (input.language !== 'en' &&
        (containsMalayalam(input.prompt) ||
          containsMalayalam(input.destination) ||
          containsMalayalam(input.startingLocation)))
        ? 'ml'
        : 'en';

    const languageDirective =
      detectedLanguage === 'ml'
        ? 'Write ALL descriptive text values (tripSummary, themes, activities, attraction descriptions, food notes, accommodation notes, travelTips, suggestedFollowUps, budget disclaimer) in natural Malayalam (മലയാളം). Keep JSON keys in English.'
        : 'Write ALL descriptive text values in clear, practical English. Keep JSON keys in English.';

    const instructions =
      'You are SAFAR (Safar), an expert bilingual (Malayalam & English) travel itinerary and budget planner. ' +
      `${languageDirective} ` +
      'CRITICAL ACCURACY RULES: ' +
      '1) NEVER invent or claim live real-time hotel prices, live room availability, or live flight seat/fare availability. Provide clearly labeled approximate planning estimates only. ' +
      '2) Provide realistic visiting times/hours and reliable road/transit travel-time estimates between stops and from the starting location. ' +
      `3) Create EXACTLY ${input.durationDays} day entries in dailyItinerary (day 1 through day ${input.durationDays}), personalized for ${input.travelStyle} travel with ${input.travelers} traveler(s). Keep 3-4 well-paced schedule items per day with concise 1-sentence notes so all days fit cleanly. ` +
      `4) All budget numbers must be numeric totals in ${input.currency} for the full trip (${input.travelers} traveler(s), ${input.durationDays} days). ` +
      'Return ONLY a valid json object matching this exact structure: ' +
      '{"destination": string, "tripSummary": string, "language": "en"|"ml", "currency": "INR"|"USD"|"EUR", ' +
      '"totalEstimatedBudget": number, ' +
      '"budgetBreakdown": {"accommodation": number, "food": number, "transportation": number, "activities": number, "total": number, "currency": "INR"|"USD"|"EUR", "disclaimer": string}, ' +
      '"dailyItinerary": [{"day": number, "date": string, "theme": string, "estimatedTravelTime": string, "schedule": [{"time": string, "activity": string, "location": string, "visitingHours": string, "travelTimeFromPrev": string, "estimatedCost": number, "notes": string}]}], ' +
      '"attractions": [{"name": string, "description": string, "bestTimeToVisit": string, "estimatedDuration": string}], ' +
      '"accommodationSuggestions": [{"name": string, "area": string, "tier": string, "approximateNightlyRange": string, "notes": string}], ' +
      '"foodRecommendations": [{"dishOrSpot": string, "type": string, "area": string, "approximateCostRange": string, "notes": string}], ' +
      '"travelTips": [string], "suggestedFollowUps": [string]}';

    const userSpec = [
      `Destination: ${input.destination}`,
      `Starting Location: ${input.startingLocation || 'Not specified'}`,
      `Departure Date: ${input.departureDate || 'Flexible'}`,
      `Return Date: ${input.returnDate || 'Flexible'}`,
      `Duration: ${input.durationDays} days`,
      `Travelers: ${input.travelers}`,
      `Travel Style: ${input.travelStyle}`,
      `Target Budget: ${input.budgetAmount > 0 ? `${input.budgetAmount} ${input.currency}` : `Reasonable ${input.travelStyle} estimate in ${input.currency}`}`,
      `Interests: ${input.interests.length > 0 ? input.interests.join(', ') : 'General sightseeing, food, culture'}`,
      `Additional Request: ${input.prompt || 'Create a balanced, memorable itinerary.'}`,
    ].join('\n');

    try {
      const reasoningModel = isReasoningModel(this.model);
      const response = await this.client.responses.create(
        {
          model: this.model,
          instructions,
          input: [
            {
              role: 'developer',
              content:
                'Return the complete structured trip itinerary and budget strictly as a valid json object.',
            },
            {
              role: 'user',
              content: userSpec,
            },
          ],
          text: {
            format: { type: 'json_object' },
          },
          ...(reasoningModel
            ? { reasoning: { effort: 'low' as const } }
            : {}),
          max_output_tokens: reasoningModel ? 12000 : 8500,
        },
        { timeout: PLAN_TIMEOUT_MS, maxRetries: 0 },
      );

      const rawOutput = stripMarkdownJsonFences(response.output_text || '');
      if (!rawOutput) {
        console.error('[OpenAI:plan] Empty response output_text', {
          model: this.model,
          status: response.status,
          incompleteDetails: response.incomplete_details,
          responseId: response.id,
        });
        throw new AIServiceError(
          424,
          'OPENAI_EMPTY_RESPONSE',
          'OpenAI returned an empty itinerary response. Please retry.',
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawOutput);
      } catch {
        console.error('[OpenAI:plan] Invalid JSON from OpenAI', {
          model: this.model,
          status: response.status,
          incompleteDetails: response.incomplete_details,
          outputLength: rawOutput.length,
          outputTail: rawOutput.slice(-160),
        });
        if (response.status === 'incomplete') {
          throw new AIServiceError(
            424,
            'OPENAI_RESPONSE_TRUNCATED',
            'The itinerary response was cut off before completing. Please retry or shorten the trip duration.',
          );
        }
        throw new AIServiceError(
          424,
          'OPENAI_INVALID_JSON',
          'OpenAI returned malformed JSON for the itinerary. Please retry.',
        );
      }

      const plan = validateStructuredTripPlan(parsed, input, detectedLanguage);

      return {
        plan,
        responseId: response.id,
        model: this.model,
        aiProvider: this.id,
      };
    } catch (error) {
      throw mapOpenAIError(error, 'plan', this.model);
    }
  }

  async chat(input: AIChatRequest): Promise<AIChatResult> {
    const detectedMalayalam =
      input.language === 'ml' ||
      (input.language !== 'en' && containsMalayalam(input.message));

    const languageDirective =
      input.language === 'ml'
        ? 'The user prefers Malayalam (മലയാളം). Write "reply" and "suggestedFollowUps" in natural Malayalam.'
        : input.language === 'en'
          ? 'The user prefers English. Write "reply" and "suggestedFollowUps" in natural English.'
          : 'Match the user\'s language automatically: if the user writes in Malayalam (മലയാളം script or Manglish), reply naturally in Malayalam; otherwise reply in English.';

    const contextClause = input.tripContext
      ? `\n\nActive Trip Context:\n${input.tripContext.slice(0, 3000)}`
      : '';

    const instructions =
      'You are SAFAR (Safar), an intelligent, warm, practical bilingual (Malayalam & English) travel planning assistant. ' +
      `${languageDirective} ` +
      'Never invent live hotel prices or live flight availability; use approximate ranges when estimating costs. ' +
      'Help the user refine itineraries, answer follow-up questions using conversation context, suggest food, hidden spots, routes, visiting hours, and crowd-avoidance advice.' +
      `${contextClause}\n` +
      'Return ONLY valid json with these keys: ' +
      '"reply" (string: helpful conversational answer), ' +
      '"language" ("en" or "ml"), ' +
      '"suggestedFollowUps" (array of 2-3 short follow-up questions in the same language).';

    const usePreviousResponseId =
      Boolean(input.previousResponseId) &&
      (!input.history || input.history.length === 0);

    const requestInput: ResponseInputItem[] = usePreviousResponseId
      ? [
          {
            role: 'developer',
            content: 'Continue the conversation and return valid json.',
          },
          {
            role: 'user',
            content: input.message,
          },
        ]
      : [
          {
            role: 'developer',
            content: 'Always return your response strictly as valid json.',
          },
          ...(input.history ?? []).map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
          {
            role: 'user' as const,
            content: input.message,
          },
        ];

    try {
      const reasoningModel = isReasoningModel(this.model);
      const response = await this.client.responses.create(
        {
          model: this.model,
          instructions,
          input: requestInput,
          ...(usePreviousResponseId && input.previousResponseId
            ? { previous_response_id: input.previousResponseId }
            : {}),
          text: {
            format: { type: 'json_object' },
          },
          ...(reasoningModel
            ? { reasoning: { effort: 'low' as const } }
            : {}),
          max_output_tokens: reasoningModel ? 3000 : 1600,
        },
        { timeout: CHAT_TIMEOUT_MS, maxRetries: 0 },
      );

      const rawOutput = stripMarkdownJsonFences(response.output_text || '');
      if (!rawOutput) {
        console.error('[OpenAI:chat] Empty response output_text', {
          model: this.model,
          status: response.status,
          incompleteDetails: response.incomplete_details,
          responseId: response.id,
        });
        throw new AIServiceError(
          424,
          'OPENAI_EMPTY_RESPONSE',
          'OpenAI returned an empty chat response.',
        );
      }

      let parsed: {
        reply?: unknown;
        language?: unknown;
        suggestedFollowUps?: unknown;
      };

      try {
        parsed = JSON.parse(rawOutput) as typeof parsed;
      } catch {
        console.error('[OpenAI:chat] Invalid JSON from OpenAI', {
          model: this.model,
          status: response.status,
          incompleteDetails: response.incomplete_details,
          outputLength: rawOutput.length,
        });
        throw new AIServiceError(
          424,
          'OPENAI_INVALID_JSON',
          'OpenAI returned malformed JSON for the chat response.',
        );
      }

      if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
        throw new AIServiceError(
          424,
          'OPENAI_INCOMPLETE_RESPONSE',
          'OpenAI response did not include a reply message.',
        );
      }

      const language: 'en' | 'ml' =
        parsed.language === 'ml' || (!parsed.language && detectedMalayalam)
          ? 'ml'
          : 'en';

      const suggestedFollowUps = Array.isArray(parsed.suggestedFollowUps)
        ? parsed.suggestedFollowUps
            .filter(
              (item): item is string =>
                typeof item === 'string' && item.trim().length > 0,
            )
            .slice(0, 3)
            .map((item) => item.trim().slice(0, 180))
        : [];

      return {
        reply: parsed.reply.trim(),
        responseId: response.id,
        model: this.model,
        language,
        suggestedFollowUps,
      };
    } catch (error) {
      throw mapOpenAIError(error, 'chat', this.model);
    }
  }
}

export function isOpenAIConfigured(): boolean {
  return Boolean(getOpenAiApiKey());
}

export function getTravelPlannerAIProvider(): TravelPlannerAIProvider {
  const apiKey = getOpenAiApiKey();
  const model = getOpenAiModel();

  if (!apiKey) {
    throw new AIServiceError(
      500,
      'OPENAI_NOT_CONFIGURED',
      'OpenAI API key is not configured on the server. Add OPENAI_API_KEY in server environment secrets.',
    );
  }

  return new OpenAITravelPlannerProvider(apiKey, model);
}
