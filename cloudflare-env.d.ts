declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AI_PROVIDER?: string;
    AI_MODEL?: string;
    AI_API_KEY?: string;
  }
}
