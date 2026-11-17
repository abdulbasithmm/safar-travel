export type SupportedLanguage = 'auto' | 'en' | 'ml';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatResponse {
  reply: string;
  responseId: string;
  model: string;
  language: 'en' | 'ml';
  suggestedFollowUps: string[];
}

export class AIClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AIClientError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const CLIENT_TIMEOUT_MS = 50_000;

export async function parseApiJsonSafely<T>(response: Response): Promise<{
  data: T | null;
  isHtmlProxy: boolean;
}> {
  const rawText = await response.text();
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { data: null, isHtmlProxy: false };
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const looksLikeHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html');

  if (looksLikeHtml) {
    return { data: null, isHtmlProxy: true };
  }

  try {
    return { data: JSON.parse(trimmed) as T, isHtmlProxy: false };
  } catch {
    return { data: null, isHtmlProxy: false };
  }
}

export async function sendAiChatMessage(params: {
  message: string;
  idToken: string;
  history?: ChatTurn[];
  previousResponseId?: string;
  language?: SupportedLanguage;
  tripContext?: string;
}): Promise<AIChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.idToken}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        message: params.message,
        history: params.history ?? [],
        previousResponseId: params.previousResponseId,
        language: params.language ?? 'auto',
        tripContext: params.tripContext,
      }),
    });

    const { data, isHtmlProxy } = await parseApiJsonSafely<
      Partial<
        AIChatResponse & {
          error?: string;
          code?: string;
          retryAfterSeconds?: number;
        }
      >
    >(response);

    if (isHtmlProxy) {
      throw new AIClientError(
        503,
        'PROXY_UNAVAILABLE',
        'The SAFAR AI service is warming up or temporarily unreachable. Please retry in a moment.',
      );
    }

    const payload = data ?? {};

    if (!response.ok || typeof payload.reply !== 'string') {
      throw new AIClientError(
        response.status,
        payload.code || 'AI_REQUEST_FAILED',
        payload.error ||
          'Unable to get a response from SAFAR AI right now. Please try again.',
        payload.retryAfterSeconds,
      );
    }

    return {
      reply: payload.reply,
      responseId: payload.responseId || '',
      model: payload.model || '',
      language: payload.language === 'ml' ? 'ml' : 'en',
      suggestedFollowUps: Array.isArray(payload.suggestedFollowUps)
        ? payload.suggestedFollowUps
        : [],
    };
  } catch (error) {
    if (error instanceof AIClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AIClientError(
        408,
        'CLIENT_TIMEOUT',
        'Request timed out after 50 seconds. Please try again.',
      );
    }
    throw new AIClientError(
      0,
      'NETWORK_ERROR',
      error instanceof Error
        ? error.message
        : 'Network error communicating with SAFAR AI.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
