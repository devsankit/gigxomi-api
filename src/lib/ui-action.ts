/**
 * UI Action Verifier and API Connectivity Helper
 * Provides consistent loading state, error catching, and diagnostic feedback
 * for all interactive buttons in the Gigxomi interface.
 */

export type ApiActionResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
  durationMs: number;
};

export async function executeApiAction<T = unknown>(
  actionName: string,
  apiCall: () => Promise<Response | { ok: boolean; [key: string]: unknown }>,
  options?: {
    onSuccess?: (data: T) => void;
    onError?: (error: string) => void;
  }
): Promise<ApiActionResult<T>> {
  const start = performance.now();
  try {
    const res = await apiCall();
    const duration = Math.round(performance.now() - start);

    // If standard fetch Response
    if (res instanceof Response) {
      const isJson = res.headers.get("content-type")?.includes("application/json");
      const payload = isJson ? await res.json().catch(() => null) : null;

      if (res.ok) {
        options?.onSuccess?.(payload as T);
        return {
          ok: true,
          data: payload as T,
          status: res.status,
          durationMs: duration,
        };
      }

      const errorMessage =
        payload?.error ||
        payload?.message ||
        `Action "${actionName}" failed (HTTP ${res.status})`;

      options?.onError?.(errorMessage);
      return {
        ok: false,
        error: errorMessage,
        status: res.status,
        durationMs: duration,
      };
    }

    // If custom payload object
    const durationCustom = Math.round(performance.now() - start);
    if (res.ok) {
      options?.onSuccess?.(res as unknown as T);
      return { ok: true, data: res as unknown as T, durationMs: durationCustom };
    }

    const err = (res.error as string) || `Action "${actionName}" failed.`;
    options?.onError?.(err);
    return { ok: false, error: err, durationMs: durationCustom };
  } catch (err: unknown) {
    const duration = Math.round(performance.now() - start);
    const message =
      err instanceof Error
        ? err.message
        : `Network error: Backend API unreachable during "${actionName}".`;

    console.error(`[API Action Error: ${actionName}]`, err);
    options?.onError?.(message);
    return {
      ok: false,
      error: message,
      durationMs: duration,
    };
  }
}
