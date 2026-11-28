import worker from './worker-entry.mjs';
import { canaryFetch, PublicSnapshot } from './public-snapshot-canary.mjs';

export { PublicSnapshot };
export default { fetch(request, env, context) {
  return canaryFetch(request, env, (next, bindings, ctx) => worker.fetch(next, bindings, ctx), context);
} };
