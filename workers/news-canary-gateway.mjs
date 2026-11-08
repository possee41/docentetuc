// News-only entry: the shared gate retains authentication, identity and lease ownership.
import gateway from './source-import-gateway.mjs';
const worker = 'docentetuc-news-canary-1-2';
const database = '853e2f5d-89b1-46a3-9c1c-5cbd46784756';
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (env.DAILY_SOURCES_ENABLED !== 'true' || env.DAILY_RECEIVER_NAME !== worker ||
      env.IMPORT_DATABASE_ID !== database || env.IMPORT_DATABASE_NAME !== 'docentetuc-web-canary-1-2' ||
      env.IMPORT_GATE_ENABLED !== 'false' || env.IMPORT_GATE_LEASE_REQUIRED !== 'true' || env.IMPORT_GATE_ALLOWED_SOURCE !== 'news')
    return Response.json({ error: 'NEWS_DISABLED' }, { status: 503 });
  if (!['/api/internal/news-discovery', '/api/internal/import-identity', '/api/internal/import-gate'].includes(url.pathname) ||
      url.pathname.endsWith('import-identity') && url.searchParams.get('source') !== 'news')
    return new Response(null, { status: 404 });
  if (url.pathname.endsWith('import-gate')) {
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let bytes = 0, text = '';
    const decoder = new TextDecoder();
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 1024) { await reader.cancel(); return new Response(null, { status: 413 }); }
        text += decoder.decode(value, { stream: true }); }
      text += decoder.decode(); const body = JSON.parse(text);
      if (body.source !== 'news' || body.action === 'open' &&
          (!Number.isInteger(body.ttlSeconds) || body.ttlSeconds < 60 || body.ttlSeconds > 600)) return new Response(null, { status: 400 });
      request = new Request(request.url, { method: request.method, headers: request.headers, body: text });
    } catch { return new Response(null, { status: 400 }); }
  }
  return gateway.fetch(request, { ...env, FDCI_EXTERNAL_ENABLED: 'false', FDCI_AUTOMATION_ENABLED: 'false', FDCI_DELTA_ENABLED: 'false' });
} };
