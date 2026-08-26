import type {
  AIAdvisorResult,
  RecoveryAIAdviceContent,
  RecoveryAIAdviceRequest,
  RecoveryAIAdvisor,
} from '../../domain/recovery-ai-advice.js';
import { aiAdviceContentSchema } from '../../domain/recovery-ai-advice.js';
import { AI_SYSTEM_PROMPT, buildAdviceUserPrompt } from '../prompt.js';

export interface OpenAICompatibleConfig {
  /** Informational label persisted with advice (e.g. "openai-compatible"). */
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

/**
 * Minimal typed client for OpenAI-compatible chat-completion APIs. Works with
 * any compatible endpoint (OpenRouter, local servers, other gateways) without
 * vendor SDKs. The model is treated as fully untrusted: its output must parse
 * as JSON and pass Zod validation before it can reach callers.
 */
export class OpenAICompatibleAdvisor implements RecoveryAIAdvisor {
  readonly provider: string;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.provider = config.provider;
  }

  async advise(request: RecoveryAIAdviceRequest): Promise<AIAdvisorResult> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [
            { role: 'system', content: AI_SYSTEM_PROMPT },
            { role: 'user', content: buildAdviceUserPrompt(request) },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      // AbortSignal.timeout rejects with a TimeoutError DOMException.
      if (error instanceof Error && error.name === 'TimeoutError') {
        return { status: 'unavailable', reason: 'timeout' };
      }
      return { status: 'unavailable', reason: 'network_error' };
    }

    if (response.status === 429) {
      return { status: 'unavailable', reason: 'rate_limited' };
    }
    if (!response.ok) {
      return { status: 'unavailable', reason: 'provider_error' };
    }

    return parseModelResponse(await safeJsonBody(response));
  }
}

/** Maps raw provider payload → validated advice or a safe unavailability. */
export function parseModelResponse(payload: unknown): AIAdvisorResult {
  const content = extractMessageContent(payload);
  if (content === null) {
    return { status: 'unavailable', reason: 'invalid_response' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonBlock(content));
  } catch {
    return { status: 'unavailable', reason: 'invalid_response' };
  }

  const result = aiAdviceContentSchema.safeParse(parsed);
  if (!result.success) {
    return { status: 'unavailable', reason: 'invalid_response' };
  }

  const validated = result.data;
  const content_: RecoveryAIAdviceContent = {
    summary: validated.summary,
    explanation: validated.explanation,
    nextStep: validated.nextStep,
    customerMessage: validated.customerMessage ?? null,
    operatorMessage: validated.operatorMessage ?? null,
    confidence: validated.confidence,
    warnings: [...validated.warnings],
  };
  return { status: 'available', content: content_ };
}

async function safeJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractMessageContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choice = (payload as ChatCompletionResponse).choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Models sometimes wrap JSON in markdown fences or prose; extract the outer
 * most JSON object before parsing. Everything else still has to pass schema
 * validation downstream.
 */
export function extractJsonBlock(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new SyntaxError('No JSON object found in model output');
  }
  return text.slice(start, end + 1);
}
