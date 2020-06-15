import { SuccessfulResponseValidator } from './successfulResponseValidator';
import { assert } from 'chai';
import { IdempotencyResponse } from '../models/models';

describe('Default response validator', () => {
    // Validator to test
    const validator = new SuccessfulResponseValidator();

    it('returns true when http status code is ok (200 >= x >= 299)', () => {
        const idempotencyResponse = new IdempotencyResponse();

        idempotencyResponse.statusCode = 201;
        assert.isTrue(validator.isValidForPersistence(idempotencyResponse));

        idempotencyResponse.statusCode = 200;
        assert.isTrue(validator.isValidForPersistence(idempotencyResponse));

        idempotencyResponse.statusCode = 299;
        assert.isTrue(validator.isValidForPersistence(idempotencyResponse));

        idempotencyResponse.statusCode = 199;
        assert.isFalse(validator.isValidForPersistence(idempotencyResponse));

        idempotencyResponse.statusCode = 300;
        assert.isFalse(validator.isValidForPersistence(idempotencyResponse));
    });
});
