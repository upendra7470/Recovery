const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number = 500) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string>),
    },
  });

  const body = await response.json();

  if (!response.ok) {
    const error = body as { error?: { code: string; message: string } };
    throw new ApiError(
      error?.error?.code ?? 'UNKNOWN_ERROR',
      error?.error?.message ?? 'An unexpected error occurred',
      response.status
    );
  }

  return body as T;
}
