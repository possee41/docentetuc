import { classifySourceError, SourceSyncError } from "./publication-lifecycle.ts";

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
