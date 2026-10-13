import type { paths } from './generated/openapi.js';

/** Every JSON-RPC method in the spec, e.g. "public/ticker" | "private/get_positions". */
export type Method = keyof paths extends infer P ? (P extends `/${infer M}` ? M : never) : never;
export type PublicMethod = Extract<Method, `public/${string}`>;
export type PrivateMethod = Extract<Method, `private/${string}`>;

type Op<M extends Method> = paths[`/${M}`]['get'];

/** Params object for a method, taken from the spec's query parameters. */
export type Params<M extends Method> = Op<M> extends { parameters: { query?: infer Q } }
  ? [Q] extends [never | undefined] ? Record<string, never> : NonNullable<Q>
  : Record<string, never>;

/** The `result` of a method's JSON-RPC response. */
export type Result<M extends Method> = Op<M> extends {
  responses: { 200: { content: { 'application/json': { result?: infer R } } } };
}
  ? R
  : unknown;

type ParamArgs<M extends Method> = {} extends Params<M> ? [params?: Params<M>] : [params: Params<M>];

type Scoped<S extends 'public' | 'private'> = {
  [M in Extract<Method, `${S}/${string}`> as M extends `${S}/${infer N}` ? N : never]: (
    ...args: ParamArgs<M>
  ) => Promise<Result<M>>;
};

export interface DeribitOptions {
  /** Default "production". */
  env?: 'production' | 'test';
  clientId?: string | null;
  clientSecret?: string | null;
  /** Transport for `call()`; subscriptions always use WebSocket. Default "http". */
  transport?: 'http' | 'ws';
  /** Check params against the spec before sending. Default true. */
  validate?: boolean;
  /** Per-request timeout. Default 10000. */
  timeoutMs?: number;
  /** Close the WebSocket after this long with no requests or subscriptions. 0 disables. Default 60000. */
  idleTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  WebSocket?: typeof globalThis.WebSocket;
  clientName?: { client_name: string; client_version: string };
}

export interface ParamInfo {
  type?: string;
  enum?: unknown[];
  items?: ParamInfo;
  oneOf?: ParamInfo[];
  description: string;
}

export interface MethodInfo {
  scope: 'public' | 'private';
  tags: string[];
  summary: string;
  description: string;
  deprecated: boolean;
  params: Record<string, ParamInfo>;
  required: string[];
}

export interface ChannelInfo {
  template: string;
  scope: 'public' | 'private';
  tags: string[];
  summary: string;
  params: Record<string, { description: string; enum?: string[] }>;
}

export interface SearchResult {
  name: string;
  kind: 'method' | 'channel';
  scope: 'public' | 'private';
  summary: string;
  score: number;
  deprecated: boolean;
}

export interface Subscription {
  /** Channels now active. */
  channels: string[];
  /** Requested channels Deribit refused (e.g. unknown instruments). */
  rejected: string[];
  unsubscribe(): Promise<void>;
}

export class Deribit {
  constructor(options?: DeribitOptions);
  readonly env: 'production' | 'test';
  readonly authenticated: boolean;
  /** `client.public.ticker({ instrument_name: 'BTC-PERPETUAL' })` */
  readonly public: Scoped<'public'>;
  /** `client.private.get_positions({ currency: 'BTC' })` */
  readonly private: Scoped<'private'>;
  call<M extends Method>(method: M, ...args: [...ParamArgs<M>, options?: { transport?: 'http' | 'ws' }]): Promise<Result<M>>;
  subscribe(channels: string | string[], listener: (data: any, channel: string) => void): Promise<Subscription>;
  /** Refused channels are omitted from the result and listed in its non-enumerable `rejected` property. */
  snapshot(channels: string | string[], options?: { timeoutMs?: number }): Promise<Record<string, any> & { rejected?: string[] }>;
  close(): void;
}

export function search(
  query: string,
  options?: { scope?: 'public' | 'private'; kind?: 'method' | 'channel' | 'all'; limit?: number },
): SearchResult[];
export function channel(template: string, params: Record<string, string | number>): string;
export function validateParams(method: string, params?: Record<string, unknown>): void;

export const methods: Record<Method, MethodInfo>;
export const channels: Record<string, ChannelInfo>;
export const apiVersion: string;

export class DeribitError extends Error {
  method: string;
  code: number;
  data?: unknown;
}
export class DeribitValidationError extends Error {
  method: string;
  problems: string[];
}
export class DeribitTransportError extends Error {
  method: string;
  status?: number;
}
