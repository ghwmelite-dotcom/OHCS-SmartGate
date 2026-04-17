export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  ENVIRONMENT: string;
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
}

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  name: string;
}
