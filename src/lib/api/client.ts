/**
 * Client-side API fetch wrapper.
 *
 * - Typed responses via generic <T>
 * - ApiError on every failure path
 * - 15s timeout default with AbortController
 * - Retry-on-transient (5xx, network, timeout), NEVER on 4xx
 * - Abort-aware retry sleep
 */

import type { ApiErrorBody } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 500;

export class ApiError extends Error {
  public readonly name = "ApiError";

  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly cause?: unknown,
  ) {
    super(message);
  }

  get isTransient(): boolean {
    return this.httpStatus === 0 || this.httpStatus >= 500;
  }

  get isClientError(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }
}

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  signal?: AbortSignal;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    idempotencyKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    signal: externalSignal,
  } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    const timeoutController = new AbortController();
    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(() => timeoutController.abort(), timeoutMs)
        : undefined;

    const composedSignal = externalSignal
      ? anySignal([externalSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "include",
        signal: composedSignal,
      });

      if (!response.ok) {
        const errorBody = await parseErrorBody(response);
        const apiError = new ApiError(
          errorBody.error,
          errorBody.message ?? errorBody.error,
          response.status,
        );

        if (apiError.isClientError) throw apiError;

        lastError = apiError;
        if (attempt < retryAttempts) {
          await abortableSleep(
            DEFAULT_RETRY_BACKOFF_MS * Math.pow(2, attempt),
            externalSignal,
          );
          continue;
        }
        throw apiError;
      }

      if (response.status === 204) return undefined as T;

      try {
        return (await response.json()) as T;
      } catch (parseErr) {
        throw new ApiError("PARSE_ERROR", "Response was not valid JSON", response.status, parseErr);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;

      if (isAbortError(err)) {
        if (externalSignal?.aborted) {
          throw new ApiError("ABORTED", "Request aborted by caller", 0, err);
        }
        lastError = new ApiError("TIMEOUT", `Request timed out after ${timeoutMs}ms`, 0, err);
        if (attempt < retryAttempts) {
          await abortableSleep(
            DEFAULT_RETRY_BACKOFF_MS * Math.pow(2, attempt),
            externalSignal,
          );
          continue;
        }
        throw lastError;
      }

      lastError = new ApiError(
        "NETWORK_ERROR",
        err instanceof Error ? err.message : "Network request failed",
        0,
        err,
      );
      if (attempt < retryAttempts) {
        await abortableSleep(
          DEFAULT_RETRY_BACKOFF_MS * Math.pow(2, attempt),
          externalSignal,
        );
        continue;
      }
      throw lastError;
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  throw lastError ?? new ApiError("UNKNOWN", "apiFetch exhausted retries", 0);
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (typeof body?.error === "string") {
      return {
        error: body.error,
        message: typeof body.message === "string" ? body.message : undefined,
      };
    }
  } catch {
    // fall through
  }
  return {
    error: `HTTP_${response.status}`,
    message: response.statusText || `Request failed with status ${response.status}`,
  };
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.code === DOMException.ABORT_ERR)
  );
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("ABORTED", "Aborted before sleep", 0));
      return;
    }
    const handle = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new ApiError("ABORTED", "Aborted during retry backoff", 0));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener(
      "abort",
      () => controller.abort(sig.reason),
      { once: true },
    );
  }
  return controller.signal;
}
