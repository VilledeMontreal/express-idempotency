// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import {
    IIdempotencyResponseValidator,
    IdempotencyResponse,
} from '../models/models';

/**
 * Implementation of response validator.
 * Check for successful responses.
 */
export class SuccessfulResponseValidator
    implements IIdempotencyResponseValidator {
    /**
     * Check if the response is in the 2XX status code range and if it is, persist it.
     * @param idempotencyResponse Response to validate
     * @returns Indicate if need to persist
     */
    public isValidForPersistence(
        idempotencyResponse: IdempotencyResponse
    ): boolean {
        return (
            idempotencyResponse.statusCode >= 200 &&
            idempotencyResponse.statusCode <= 299
        );
    }
}
