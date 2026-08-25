const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export interface ApiHealthSnapshot {
  online: boolean;
}

export async function getApiHealth(): Promise<ApiHealthSnapshot> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return { online: false };
    }

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return { online: false };
    }

    const status = (payload as { status?: unknown }).status;
    return status === 'ok' ? { online: true } : { online: false };
  } catch {
    return { online: false };
  }
}
