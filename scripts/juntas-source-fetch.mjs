// Node-only transport: count every redirect hop, never retry or forward keys to another origin.
export function createJuntasSourceFetch({fetcher=fetch,maxRequests=25,maxBytes=8_000_000}={}) {
  if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>25)throw Error('JUNTAS_BUDGET_INVALID');
  const trace=[];
  const allowed=url=>url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
    (['docs.google.com','www.googleapis.com','drive.google.com'].includes(url.hostname)||url.hostname.endsWith('.googleusercontent.com'));
  const request=async(input,init={})=>{
    let url=new URL(String(input)),headers=new Headers(init.headers);
    for(let hop=0;hop<4;hop++){
      if(!allowed(url))throw Error('JUNTAS_SOURCE_NETWORK');
      if(trace.length>=maxRequests)throw Error('JUNTAS_REQUEST_BUDGET_EXHAUSTED');
      const row={host:url.hostname,path:url.pathname};trace.push(row);const start=performance.now();
      let response;
      try{response=await fetcher(url.toString(),{...init,headers,redirect:'manual'});row.status=response.status;}
      catch(error){row.error=/timeout|abort/i.test(error?.name||'')?'timeout':'network';throw error;}
      finally{row.elapsedMs=Math.round(performance.now()-start);}
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('location');await response.body?.cancel();
        if(!location||hop===3)throw Error('JUNTAS_SOURCE_NETWORK');
        const next=new URL(location,url);
        if(next.origin!==url.origin){headers=new Headers();}
        url=next;continue;
      }
      if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('JUNTAS_DOCUMENT_FORMAT_INVALID');}
      return response;
    }
    throw Error('JUNTAS_SOURCE_NETWORK');
  };
  return {fetch:request,metrics:()=>({requests:trace.length,trace:trace.map(row=>({...row}))})};
}
