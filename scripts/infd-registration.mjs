// Enrollment HTML is checked in Node, never in the Worker or on a teacher page load.
import { infdOfferUrl, parseInfdOffer } from '../lib/infd-registration.ts';
export function createInfdRegistrationVerifier(fetcher = fetch, now = new Date(), maxRequests = 3) {
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 3) throw Error('INFD_VERIFICATION_BUDGET_INVALID');
  let requests = 0; const pages = new Map();
  return async item => {
    const url = item.metadata.registrationUrl;
    if (!infdOfferUrl(url)) return item; // Other enrollment platforms retain their existing behavior.
    const unknown = (reason, attempted = true) => ({status:'UNVERIFIED',reason,url,checkedAt:attempted ? now.toISOString() : null});
    if (!pages.has(url) && requests < maxRequests) {
      requests++;
      pages.set(url, (async () => {
        try {
          const response = await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
          if (Number(response.headers.get('content-length') || 0) > 262144) { await response.body?.cancel(); return {verification:unknown('BODY_LIMIT')}; }
          const reader=response.body?.getReader(), chunks=[];let size=0;
          if (!reader) return {verification:unknown('EMPTY_RESPONSE')};
          while (true) { const {done,value}=await reader.read();if(done)break;size+=value.length;
            if(size>262144){await reader.cancel();return{verification:unknown('BODY_LIMIT')};}chunks.push(value); }
          const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
          const prefix=new TextDecoder().decode(bytes.slice(0,2048));
          const charset=response.headers.get('content-type')?.match(/charset=["']?([^;\s"']+)/i)?.[1] || prefix.match(/charset=["']?([^\s"'>;]+)/i)?.[1] || 'utf-8';
          if(!/^(utf-8|utf8|iso-8859-1|windows-1252)$/i.test(charset))return{verification:unknown('CHARSET_UNSUPPORTED')};
          return {html:new TextDecoder(charset,{fatal:true}).decode(bytes),status:response.status};
        } catch {return{verification:unknown('REQUEST_FAILED')};}
      })());
    }
    const page=pages.has(url)?await pages.get(url):{verification:unknown('REQUEST_BUDGET',false)};
    const verification=page.verification || parseInfdOffer(page.html,url,item.title,page.status,now);
    const status=verification.status==='UNAVAILABLE'?'oferta no disponible':verification.status==='CLOSED'?'inscripción cerrada':item.status;
    return {...item,status,metadata:{...item.metadata,registrationVerification:verification}};
  };
}
