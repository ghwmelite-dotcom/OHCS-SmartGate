import type { Env } from '../types';

export function devLog(env: Pick<Env, 'ENVIRONMENT'>, ...args: unknown[]): void {
  if (env.ENVIRONMENT !== 'production') console.log(...args);
}

export function devError(env: Pick<Env, 'ENVIRONMENT'>, ...args: unknown[]): void {
  if (env.ENVIRONMENT !== 'production') console.error(...args);
}
