// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import * as HttpStatus from 'http-status-codes';

/**
 * Base class for all errors emitted by the idempotency middleware.
 *
 * The error carries the intended HTTP status on both `statusCode` and `status`
 * so that any Express error handler — including the framework's built-in
 * `finalhandler`, which reads `err.status || err.statusCode` — derives the
 * correct response code instead of falling back to a generic `500`.
 *
 * Consumers can branch on the concrete subclass with `instanceof`.
 */
export class IdempotencyError extends Error {
    /** Intended HTTP status code (e.g. 409, 417). */
    public readonly statusCode: number;

    /** Alias of {@link statusCode} for error handlers that read `status`. */
    public readonly status: number;

    /**
     * @param message Human-readable error message.
     * @param statusCode HTTP status code to surface to the caller.
     */
    constructor(message: string, statusCode: number) {
        super(message);
        this.name = new.target.name;
        this.statusCode = statusCode;
        this.status = statusCode;

        // Restore the prototype chain: when targeting older runtimes, extending
        // a built-in like Error can break `instanceof`. Using `new.target`
        // keeps the check correct for subclasses as well.
        Object.setPrototypeOf(this, new.target.prototype);

        // Capture a clean stack trace on V8 (no-op elsewhere).
        const captureStackTrace = (
            Error as unknown as {
                captureStackTrace?: (target: object, ctor?: unknown) => void;
            }
        ).captureStackTrace;
        if (captureStackTrace) {
            captureStackTrace(this, new.target);
        }
    }
}

/**
 * Raised when a request reuses an idempotency key whose previous request is
 * still in progress (no response cached yet). Surfaces as HTTP `409 Conflict`,
 * signalling the caller to retry later.
 */
export class IdempotencyConflictError extends IdempotencyError {
    constructor(
        message = 'A previous request is still in progress for this key.'
    ) {
        super(message, HttpStatus.CONFLICT);
    }
}

/**
 * Raised when an idempotency key is reused on a request that does not match the
 * original one (intent mismatch). Surfaces as HTTP `417 Expectation Failed`,
 * signalling the caller to correct the request.
 */
export class IdempotencyIntentMismatchError extends IdempotencyError {
    constructor(
        message = 'Misuse of the idempotency key. Please check your request.'
    ) {
        super(message, HttpStatus.EXPECTATION_FAILED);
    }
}
