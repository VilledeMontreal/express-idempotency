// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { Request } from 'express';

/**
 * Idempotency request.
 */
export interface IdempotencyRequest {
    body: any;
    headers: any;
    method: string;
    query: any;
    url: string;
}

/**
 * Idempotency response.
 * Keep a reference of the response (ex: http status) and the body.
 */
export class IdempotencyResponse {
    public statusCode?: number;
    public headers: any;
    public body?: any;
}

/**
 * Idempotency resource.
 * Used to associate a idempotency key to its request and response.
 * Since we are in a REST context, expecting the body of the request and the response
 * to be of the same type.
 */
// tslint:disable-next-line:interface-name
export interface IdempotencyResource {
    /**
     * The key which make the operation idempotent.
     */
    idempotencyKey: string;

    /**
     * The initial request. Can be used to validate that a subsequent
     * request if the same and the idempotency key is not misused.
     */
    request: IdempotencyRequest;

    /**
     * The response received from the operation and that will
     * be returned for a matching idempotency key.
     */
    response?: IdempotencyResponse;

    /**
     * Timestamp set by the middleware when the resource is created (processing start).
     * Used by the `processingTimeout` lease mechanism to detect orphaned in-progress
     * resources and allow a subsequent request to take over processing.
     * Adapters must persist and return this field for the expiry feature to be active;
     * if absent, the resource is treated as non-expired (safe degradation).
     */
    createdAt?: Date | number;
}

/**
 * Interface for response validator implementation.
 */
export interface IIdempotencyResponseValidator {
    /**
     * Determine if the response is valid for persistance.
     * @param idempotencyResponse Response to validate
     * @returns Indicate if need to persist
     */
    isValidForPersistence(idempotencyResponse: IdempotencyResponse): boolean;
}

/**
 * Interface to implement for idempotency resource persistence.
 */
export interface IIdempotencyDataAdapter {
    /**
     * Find the resource for a specific idempotency key.
     * @param idempotencyKey Idempotency key
     * @returns Idempotency resource
     */
    findByIdempotencyKey(
        idempotencyKey: string
    ): Promise<IdempotencyResource | null>;

    /**
     * Create a idempotency resource.
     * @param idempotencyResource Idempotency resource
     */
    create(idempotencyResource: IdempotencyResource): Promise<void>;

    /**
     * Update a idempotency resource.
     * @param idempotencyResource Idempotency resource
     */
    update(idempotencyResource: IdempotencyResource): Promise<void>;

    /**
     * Delete a idempotency resource.
     * @param idempotencyKey Resource to delete
     */
    delete(idempotencyKey: string): Promise<void>;
}

/**
 * Interface for intent validator implementation.
 * Used to check when a idempotency key is found, the intent of the request
 * is corresponding to the original request. This is to prevent idempotency key
 * to be use incorrectly.
 */
export interface IIdempotencyIntentValidator {
    /**
     * Valid the intent of the request.
     * @param req request to validate
     * @param idempotencyRequest orignal request which generate a idempotency resource
     */
    isValidIntent(
        req: Request,
        idempotencyRequest: IdempotencyRequest
    ): boolean;
}

/**
 * Options available to configure the idempotency middleware.
 */
// tslint:disable-next-line:interface-name
export interface IdempotencyOptions {
    // Specify the header to be used to retrieve the idempotency key.
    // Default value is 'idempotency-key'.
    idempotencyKeyHeader?: string;
    // The data adapter used to store the resources.
    // Default is the InMemoryDataAdapter.
    dataAdapter?: IIdempotencyDataAdapter;
    // Logic to indicate if response must be kept for idempotency
    // Default is the SuccessfulResponseValidator.
    responseValidator?: IIdempotencyResponseValidator;
    // Validate the intent of the request
    // Default is the DefaultIntentValidator.
    intentValidator?: IIdempotencyIntentValidator;
    /**
     * Maximum time in milliseconds allowed for a request to complete before its
     * in-progress resource is considered orphaned and can be taken over by a
     * subsequent retry. Values of `undefined`, `0`, or any non-positive / non-finite
     * number disable the feature (default: disabled — behaviour identical to v2.0.0).
     * Requires the data adapter to persist and return `IdempotencyResource.createdAt`;
     * without it the feature is silently inert.
     * Choose a value at least 2× the worst-case processing duration to avoid false
     * takeovers. Note: due to the check-then-act nature of the takeover, at-least-once
     * delivery semantics apply when the timeout is reached.
     */
    processingTimeout?: number;
    /**
     * Case-insensitive whitelist of request header names persisted into the
     * `IdempotencyResource`. Any header not in this list is stripped before the
     * request is handed to the data adapter, so secrets such as `Authorization`,
     * `Cookie` or API keys are never stored at rest for the lifetime of the TTL.
     * Default: `['content-type']`. Pass `[]` to persist no headers, or add the
     * header names a custom `intentValidator` needs to compare. A provided list
     * replaces the default entirely (it is not merged), so re-include
     * `content-type` explicitly if you still need it.
     *
     * Note: the persisted headers are filtered, but the live `req.headers` passed
     * to `intentValidator.isValidIntent(req, idempotencyRequest)` are not — a
     * custom validator comparing a header must account for that asymmetry.
     */
    requestHeaderWhitelist?: string[];
}
