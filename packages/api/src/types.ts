export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  ENVIRONMENT: string;
}

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  name: string;
}
