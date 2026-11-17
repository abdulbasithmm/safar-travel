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
  contentType: string;
  rawSnippet: string;
}> {
  const rawText = await response.text();
  const trimmed = rawText.trim();
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawSnippet = trimmed.replace(/\s+/g, ' ').slice(0, 180);

  if (!trimmed) {
    return { data: null, isHtmlProxy: false, contentType, rawSnippet: '' };
  }

  const looksLikeHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html');

  if (looksLikeHtml) {
    return { data: null, isHtmlProxy: true, contentType, rawSnippet };
  }

  try {
    return {
      data: JSON.parse(trimmed) as T,
      isHtmlProxy: false,
      contentType,
      rawSnippet,
    };
  } catch {
    return { data: null, isHtmlProxy: false, contentType, rawSnippet };
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CLIENT_TIMEOUT_MS);

  const endpoint = '/api/ai/chat';
  try {
    const response = await fetch(endpoint, {
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

    const { data, isHtmlProxy, contentType, rawSnippet } =
      await parseApiJsonSafely<
        Partial<
          AIChatResponse & {
            error?: string;
            code?: string;
            retryAfterSeconds?: number;
          }
        >
      >(response);

    if (isHtmlProxy) {
      console.error('[SAFAR AI] Unexpected HTML gateway response', {
        endpoint,
        status: response.status,
        contentType,
        detail: rawSnippet,
      });
      throw new AIClientError(
        503,
        'PROXY_UNAVAILABLE',
        'The SAFAR AI service is warming up or temporarily unreachable. Please retry in a moment.',
      );
    }

    const payload = data ?? {};

    if (!response.ok || typeof payload.reply !== 'string') {
      const code =
        payload.code ||
        (response.status === 404
          ? 'AI_ENDPOINT_NOT_FOUND'
          : response.status === 502 ||
              response.status === 503 ||
              response.status === 504
            ? 'AI_GATEWAY_UNAVAILABLE'
            : 'AI_REQUEST_FAILED');

      console.error('[SAFAR AI] Chat API error', {
        endpoint,
        status: response.status,
        code,
        contentType: contentType || 'unknown',
        detail: payload.error || rawSnippet || 'Missing reply payload',
      });

      const message =
        response.status === 404
          ? 'SAFAR AI chat endpoint is unavailable (HTTP 404). Please ensure backend API routes are deployed and retry.'
          : response.status === 502 ||
              response.status === 503 ||
              response.status === 504
            ? 'The SAFAR AI service timed out or is temporarily unavailable. Please retry in a moment.'
            : payload.error ||
              'Unable to get a response from SAFAR AI right now. Please try again.';

      throw new AIClientError(
        response.status,
        code,
        message,
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
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      console.error('[SAFAR AI] Chat request timed out', {
        endpoint,
        timeoutMs: CLIENT_TIMEOUT_MS,
      });
      throw new AIClientError(
        408,
        'CLIENT_TIMEOUT',
        'Request timed out after 50 seconds. Please try again.',
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : 'Network error communicating with SAFAR AI.';
    console.error('[SAFAR AI] Chat network failure', { endpoint, message });
    throw new AIClientError(0, 'NETWORK_ERROR', message);
  } finally {
    clearTimeout(timeout);
  }
}
