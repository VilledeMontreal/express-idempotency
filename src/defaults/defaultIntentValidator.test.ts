import { DefaultIntentValidator } from './defaultIntentValidator';
import { assert } from 'chai';
import * as httpMocks from 'node-mocks-http';
import { IdempotencyRequest } from '../models/models';

describe('Default intent validator', () => {
    // Validator to test
    const validator = new DefaultIntentValidator();

    const idempotencyRequest: IdempotencyRequest = {
        url: 'http://something/path',
        method: 'POST',
        query: {
            param1: 'a',
            param2: 'b',
        },
        headers: {
            'content-type': 'application/json',
            'X-Correlation-ID': 'correlationId',
        },
        body: {
            property1: 'z',
            property2: 'y',
            nestedProperties: {
                nestedProperty1: 'a',
                nestedProperty2: 'b',
            },
        },
    };

    it('validates the intent', () => {
        const req = httpMocks.createRequest({
            url: 'http://something/path',
            query: idempotencyRequest.query,
            method: 'POST',
            headers: idempotencyRequest.headers,
            body: idempotencyRequest.body,
        });

        assert.isTrue(validator.isValidIntent(req, idempotencyRequest));
    });

    it('detects unmatching url', () => {
        const req = httpMocks.createRequest({
            url: 'http://something/wrong-path',
            method: 'POST',
            query: idempotencyRequest.query,
            body: idempotencyRequest.body,
        });

        assert.isFalse(validator.isValidIntent(req, idempotencyRequest));
    });

    it('detects unmatching method', () => {
        const req = httpMocks.createRequest({
            url: 'http://something/path',
            method: 'PUT',
            query: idempotencyRequest.query,
            body: idempotencyRequest.body,
        });

        assert.isFalse(validator.isValidIntent(req, idempotencyRequest));
    });

    it('detects unmatching query parameters', () => {
        const req = httpMocks.createRequest({
            url: 'http://something/path',
            method: 'POST',
            query: {
                param1: 'a',
                param2: 'c',
            },
            body: idempotencyRequest.body.deepCl,
        });

        assert.isFalse(validator.isValidIntent(req, idempotencyRequest));
    });

    it('detects unmatching body', () => {
        const req = httpMocks.createRequest({
            url: 'http://something/path',
            method: 'POST',
            query: idempotencyRequest.query,
            body: {
                property1: 'z',
                property2: 'y',
                nestedProperties: {
                    nestedProperty1: 'a',
                    nestedProperty2: 'd',
                },
            },
        });

        assert.isFalse(validator.isValidIntent(req, idempotencyRequest));
    });
});
