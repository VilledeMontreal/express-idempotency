// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

// Per-request safety timeout: turns a handler parked forever (a bug, or a gate
// never released) into an explicit AbortError well before Mocha's global
// timeout, instead of an opaque hang. No legitimate scenario parks a request
// this long.
const REQUEST_TIMEOUT_MS = 8000;

export interface E2EResponse {
    status: number;
    headers: Record<string, string>;
    body: any;
}

export interface E2ERequestOptions {
    path: string;
    method?: string;
    key?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}

/**
 * Perform a real HTTP request against the running harness server using the
 * native fetch (Node >= 18). Parses JSON when the response advertises it,
 * otherwise returns the raw text body. Falls back to a safety timeout when no
 * explicit AbortSignal is provided.
 */
export async function req(
    baseUrl: string,
    options: E2ERequestOptions
): Promise<E2EResponse> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.key) {
        headers['Idempotency-Key'] = options.key;
    }
    let payload: string | undefined;
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(options.body);
    }

    const response = await fetch(`${baseUrl}${options.path}`, {
        method: options.method ?? 'GET',
        headers,
        body: payload,
        signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
        responseHeaders[name] = value;
    });

    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    return { status: response.status, headers: responseHeaders, body };
}
