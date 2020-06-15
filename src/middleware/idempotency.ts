// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import * as express from 'express';
import { IdempotencyOptions } from '../models/models';
import { IdempotencyService } from '../services/idempotencyService';

export const ERROR_MSG_NOT_INITIALIZED =
    'Idempotency service has not been initialized by the middleware.';

// Represent a valid function to use as a middleware for express
type expressMiddleware = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) => Promise<void>;

// Keep a single instance of the service
let idempotencyService: IdempotencyService = null;

export function getSharedIdempotencyService(): IdempotencyService {
    if (idempotencyService) {
        return idempotencyService;
    }
    throw new Error(ERROR_MSG_NOT_INITIALIZED);
}

/**
 * Return a function used as a express middleware.
 */
export const idempotency = (
    options?: IdempotencyOptions
): expressMiddleware => {
    idempotencyService = new IdempotencyService(options);
    return idempotencyService.provideMiddlewareFunction;
};
