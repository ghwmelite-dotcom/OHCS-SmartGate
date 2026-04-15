export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  ENVIRONMENT: string;
}

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  name: string;
}
