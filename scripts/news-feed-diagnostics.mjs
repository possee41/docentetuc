const sources = { ministry: 'Ministerio', atep: 'ATEP', infod: 'INFoD' };
export function classifyNewsFeedError(error) {
  const chain=[]; for(let e=error; e && chain.length<4; e=e.cause) chain.push(e);
  const text=chain.map(e=>`${e.name ?? ''} ${e.code ?? ''} ${e.message ?? ''}`).join(' ');
  const http=/NEWS_FEED_HTTP_(\d{3})\b/.exec(text);
  if(http)return {type:'HTTP',httpStatus:Number(http[1])};
  if(/TimeoutError|AbortError|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT/.test(text))return {type:'TIMEOUT'};
  if(/ERR_TLS_|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(text))return {type:'TLS'};
  if(/redirect|redirection/i.test(text))return {type:'REDIRECT'};
  if(/NEWS_FEED_(?:TOO_LARGE|CONTENT_TYPE_INVALID)/.test(text))return {type:'CONTENT'};
  if(/NEWS_FEED_(?:EMPTY|URL_INVALID|HOST_BLOCKED)|SyntaxError/.test(text))return {type:'FORMAT'};
  if(/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN|UND_ERR_|network/i.test(text))return {type:'NETWORK'};
  return {type:'UNKNOWN'};
}
export async function diagnoseNewsFeed(feed, operation, {report=event=>console.error(JSON.stringify(event)),clock=()=>new Date()}={}) {
  if(!Object.hasOwn(sources,feed?.key))throw Error('NEWS_DIAGNOSTIC_SOURCE_INVALID');
  const startedAt=clock().toISOString();
  try{return await operation();}
  catch(error){
    const failure={event:'NEWS_SOURCE_FAILURE',source:feed.key,sourceName:sources[feed.key],phase:'collection',startedAt,failedAt:clock().toISOString(),...classifyNewsFeedError(error)};
    report(failure); // Only allowlisted fields; never serialize the error, URL, headers or content.
    throw new Error(`NEWS_${feed.key.toUpperCase()}_${failure.type}`,{cause:error});
  }
}
