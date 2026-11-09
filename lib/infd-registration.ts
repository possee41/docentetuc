import { plainText, type TrainingMetadata } from './training.ts';
type Verification = NonNullable<TrainingMetadata['registrationVerification']>;
const normalized = (value: string) => plainText(value.replace(/&aacute;/gi,'á')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function infdOfferUrl(value: string | undefined) {
  try { const url = new URL(value || '');
    if (url.origin !== 'https://aulastic.infd.edu.ar' || url.pathname !== '/catalogo.cgi' || url.username || url.password || url.hash ||
        url.searchParams.get('wAccion') !== 'oferta_view' || !/^\d+$/.test(url.searchParams.get('oferta_id') || '') ||
        [...url.searchParams.keys()].some(k => !['wAccion','oferta_id'].includes(k)) || [...url.searchParams.keys()].length !== 2) return null;
    return url;
  } catch { return null; }
}
export function parseInfdOffer(html: string, requestedUrl: string, courseTitle: string, httpStatus = 200, now = new Date()): Verification {
  const result = (status: Verification['status'], reason: string): Verification => ({status, reason, url:requestedUrl, checkedAt:now.toISOString()});
  const url = infdOfferUrl(requestedUrl);
  if (!url) return result('UNVERIFIED','URL_NOT_APPROVED');
  if ([404,410].includes(httpStatus)) return result('UNAVAILABLE','HTTP_UNAVAILABLE');
  if (httpStatus !== 200) return result('UNVERIFIED','HTTP_ERROR');
  // AulaS-TIC can answer oferta_view with ListView + an error + unrelated recommendations.
  const bootstrap = html.match(/new\s+Educativa\.Aula\.Catalogo\.(\w+)\((\{[^\r\n]*\})\);/);
  if (bootstrap) {
    try { const data = JSON.parse(bootstrap[2]) as {errors?: {msg?: string}[]};
      if (Array.isArray(data.errors) && data.errors.some(e => /la oferta no esta disponible/.test(normalized(String(e.msg || ''))))) return result('UNAVAILABLE','OFFICIAL_UNAVAILABLE_NOTICE');
    } catch { return result('UNVERIFIED','BOOTSTRAP_INVALID'); }
    if (bootstrap[1] === 'ListView') return result('UNVERIFIED','CATALOG_FALLBACK');
  }
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  if (/la oferta no esta disponible/.test(normalized(main))) return result('UNAVAILABLE','OFFICIAL_UNAVAILABLE_NOTICE');
  // Positive evidence must belong to the requested offer, never to recommendation cards.
  const heading = main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const identity = [...main.matchAll(/<input\b[^>]*>/gi)].some(([tag]) =>
    /\bname=["']oferta_id["']/i.test(tag) && tag.match(/\bvalue=["'](\d+)["']/i)?.[1] === url.searchParams.get('oferta_id'));
  if (!identity || !heading || normalized(heading) !== normalized(courseTitle)) return result('UNVERIFIED','OFFER_IDENTITY_UNCONFIRMED');
  // Exclude secondary cards even inside main before inspecting enrollment wording.
  const detail = main.split(/<(?:aside|section|div)\b[^>]*(?:recomend|otras[-_ ]?ofertas|related)/i)[0];
  const text = normalized(detail);
  if (/inscripcion(?:es)? (?:cerrada|cerradas)|inscripcion no disponible/.test(text)) return result('CLOSED','EXPLICIT_CLOSED');
  const ownForm = [...detail.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].find(([,form]) =>
    [...form.matchAll(/<input\b[^>]*>/gi)].some(([tag]) => /\bname=["']oferta_id["']/i.test(tag) && tag.match(/\bvalue=["'](\d+)["']/i)?.[1] === url.searchParams.get('oferta_id')))?.[1];
  if (/inscripcion(?:es)? abierta/.test(text) && ownForm && /<button\b[^>]*>\s*(?:Inscribirme|Inscribirse)\s*<\/button>/i.test(ownForm)) return result('OPEN','EXPLICIT_OPEN');
  return result('UNVERIFIED','NO_ENROLLMENT_EVIDENCE');
}
