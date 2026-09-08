/**
 * JSON-RPC 2.0 framing for the TrueNAS middleware API (wss://<host>/api/current).
 *
 * Verified against https://api.truenas.com/v25.10/jsonrpc.html:
 *   - request:   { jsonrpc, id, method, params }
 *   - response:  { jsonrpc, id, result }  OR  { jsonrpc, id, error }
 *   - error:     { code, message, data }
 *   - push:      { jsonrpc, method: "collection_update", params: {...} }
 *                { jsonrpc, method: "notify_unsubscribed", params: {...} }
 */

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params: unknown[];
}

export interface JsonRpcErrorObject {
	code: number;
	message: string | null;
	data?: unknown;
}

export interface JsonRpcSuccess {
	jsonrpc: '2.0';
	id: number;
	result: unknown;
}

export interface JsonRpcError {
	jsonrpc: '2.0';
	id: number;
	error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/**
 * A subscription push. The middleware delivers subscribed events as
 * `collection_update` notifications; `fields` carries the record and `msg` is
 * the kind of change ("added" / "changed" / "removed" observed in practice).
 */
export interface CollectionUpdate {
	msg: string;
	collection: string;
	id?: unknown;
	fields?: Record<string, unknown>;
	extra?: unknown;
}

/** Raised when the middleware returns a JSON-RPC `error` for a call. */
export class MiddlewareError extends Error {
	readonly code: number;
	readonly data: unknown;
	constructor(err: JsonRpcErrorObject, method: string) {
		super(`${method} failed: ${err.message ?? 'unknown error'} (code ${err.code})`);
		this.name = 'MiddlewareError';
		this.code = err.code;
		this.data = err.data;
	}
}

/** The socket is not currently connected/authenticated. Retryable by design. */
export class NotConnectedError extends Error {
	readonly retryable = true;
	constructor(message: string) {
		super(message);
		this.name = 'NotConnectedError';
	}
}

/** Authentication (auth.login_ex) did not return response_type SUCCESS. */
export class AuthError extends Error {
	readonly responseType: string;
	constructor(responseType: string, detail?: string) {
		super(`authentication failed: ${responseType}${detail ? ` — ${detail}` : ''}`);
		this.name = 'AuthError';
		this.responseType = responseType;
	}
}

export function isResponse(msg: unknown): msg is JsonRpcResponse {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		'id' in msg &&
		('result' in msg || 'error' in msg)
	);
}
