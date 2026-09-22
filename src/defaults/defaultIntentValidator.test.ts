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

    // Regression #51: Express 5 null-prototype req.query vs stored request
    // returned as plain objects by a serialising adapter (JSON round-trip).
    describe('against a stored request round-tripped through JSON (serialising adapter)', () => {
        const storedRequest: IdempotencyRequest = JSON.parse(
            JSON.stringify(idempotencyRequest)
        );

        function nullProtoQuery(query: object): object {
            return Object.assign(Object.create(null), query);
        }

        it('validates the intent when req.query is a null-prototype object', () => {
            const req = httpMocks.createRequest({
                url: 'http://something/path',
                method: 'POST',
                headers: idempotencyRequest.headers,
                body: idempotencyRequest.body,
            });
            req.query = nullProtoQuery(idempotencyRequest.query) as any;

            assert.isTrue(validator.isValidIntent(req, storedRequest));
        });

        it('validates the intent when both query objects are empty (null-prototype vs {})', () => {
            const noQueryStored: IdempotencyRequest = JSON.parse(
                JSON.stringify({ ...idempotencyRequest, query: {} })
            );
            const req = httpMocks.createRequest({
                url: 'http://something/path',
                method: 'POST',
                headers: idempotencyRequest.headers,
                body: idempotencyRequest.body,
            });
            req.query = nullProtoQuery({}) as any;

            assert.isTrue(validator.isValidIntent(req, noQueryStored));
        });

        it('still detects an unmatching null-prototype query', () => {
            const req = httpMocks.createRequest({
                url: 'http://something/path',
                method: 'POST',
                headers: idempotencyRequest.headers,
                body: idempotencyRequest.body,
            });
            req.query = nullProtoQuery({ param1: 'a', param2: 'c' }) as any;

            assert.isFalse(validator.isValidIntent(req, storedRequest));
        });
    });
});
