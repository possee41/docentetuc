import { classifySourceError, sourceErrorCode, SourceSyncError } from "./publication-lifecycle.ts";

// Only public paths and classified errors: never log response bodies, headers or query strings.
export function sourcePageDiagnostics<T>(urls: string[], results: PromiseSettledResult<T[]>[]) {
  return results.map((result, index) => ({
    page: new URL(urls[index]).pathname,
    records: result.status === "fulfilled" ? result.value.length : 0,
    status: result.status === "fulfilled" ? "OK" : classifySourceError(result.reason),
    errorCode: result.status === "fulfilled" ? null : sourceErrorCode(result.reason),
  }));
}

// One attempt per page. A failing subsource must not discard its healthy siblings.
export async function collectSourcePages<T>(urls: string[], readPage: (url: string) => Promise<T[]>) {
  const pages = await Promise.allSettled(urls.map(readPage));
  return {
    items: pages.flatMap(page => page.status === "fulfilled" ? page.value : []),
    complete: pages.every(page => page.status === "fulfilled"),
    allFailed: pages.every(page => page.status === "rejected"),
    diagnostics: sourcePageDiagnostics(urls, pages),
  };
}

type JsonSourceOptions = {
  source: string;
  signal?: AbortSignal;
  headers?: HeadersInit;
  rejectRedirect?: boolean;
  fetcher?: typeof fetch;
};

function transportError(source: string, error: unknown) {
  const status = classifySourceError(error);
  const message = error instanceof Error ? error.message.slice(0, 160) : String(error || "unknown error").slice(0, 160);
  return new SourceSyncError(status === "UNKNOWN" ? "NETWORK_ERROR" : status, `${source} request failed: ${message}`);
}

export async function fetchSourceJson<T>(url: string, options: JsonSourceOptions): Promise<T> {
  let response: Response;
  try {
    response = await (options.fetcher || fetch)(url, {
      signal: options.signal,
      headers: options.headers,
    });
  } catch (error) {
    throw transportError(options.source, error);
  }

  const contentType = response.headers.get("content-type") || "unknown content-type";
  if (options.rejectRedirect !== false && response.redirected) {
    throw new SourceSyncError("REDIRECT_ERROR", `${options.source} returned an unexpected redirect (${contentType})`);
  }
  if (!response.ok) {
    throw new SourceSyncError("HTTP_ERROR", `${options.source} returned HTTP ${response.status} (${contentType})`, `HTTP_${response.status}`);
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw transportError(options.source, error);
  }
  if (!body.trim()) throw new SourceSyncError("EMPTY_RESPONSE", `${options.source} returned an empty response (${contentType})`);
  if (/text\/html|application\/xhtml/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body)) {
    throw new SourceSyncError("HTML_RESPONSE", `${options.source} returned HTML instead of JSON (${contentType})`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new SourceSyncError("PARSE_ERROR", `${options.source} returned invalid JSON (${contentType})`);
  }
}
