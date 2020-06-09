import { IIdempotencyIntentValidator } from './../models/models';
// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { IdempotencyRequest } from '../models/models';
import * as express from 'express';
import deepEqual from 'deep-equal';

/**
 * This is the default implementation of the intent validator.
 * It basically check only the request address to see if it is corresponding.
 */
export class DefaultIntentValidator implements IIdempotencyIntentValidator {
    /**
     * Check if the original and current request url is the same.
     * @param req request to validate
     * @param idempotencyRequest original request which created the idempotency resource
     */
    isValidIntent(
        req: express.Request,
        idempotencyRequest: IdempotencyRequest
    ): boolean {
        // Compare original and current requests
        return (
            req.url === idempotencyRequest.url &&
            req.method === idempotencyRequest.method &&
            deepEqual(req.query, idempotencyRequest.query) &&
            deepEqual(req.body, idempotencyRequest.body)
        );
    }
}
