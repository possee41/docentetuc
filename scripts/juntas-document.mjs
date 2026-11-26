// Only full public document navigations. APIs, RSC, private operations and all
// other sections continue through the application and its existing controls.
export function juntasDocument(request, documents) {
  const accept = request.headers.get('accept') || '*/*';
  if (!['GET', 'HEAD'].includes(request.method) ||
      !accept.includes('text/html') && !accept.includes('*/*') ||
      request.headers.has('rsc') || request.headers.has('next-router-state-tree')) return null;
  const url = new URL(request.url);
  const section = url.searchParams.get('section');
  if (url.pathname !== '/' || url.searchParams.has('_rsc') ||
      !['padrones', 'comunicados'].includes(section) || !documents[section]) return null;
  return new Response(request.method === 'HEAD' ? null : documents[section], {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      Vary: 'Accept, RSC, Next-Router-State-Tree' },
  });
}
