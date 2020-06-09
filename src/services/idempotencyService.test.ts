import { DefaultIntentValidator } from './../defaults/defaultIntentValidator';
import { InMemoryDataAdapter } from './../defaults/inMemoryDataAdapter';
import { SuccessfulResponseValidator } from './../defaults/successfulResponseValidator';
import { assert } from 'chai';
import * as faker from 'faker';
import {
    IdempotencyResource,
    IdempotencyRequest,
    IdempotencyResponse,
} from '../models/models';
import * as httpMocks from 'node-mocks-http';
import { IdempotencyService } from './idempotencyService';
import * as express from 'express';
import sinon from 'sinon';

describe('Idempotency service', () => {
    let idempotencyService: IdempotencyService = null;
    let intentValidator: DefaultIntentValidator = null;
    let dataAdapter: InMemoryDataAdapter = null;
    let responseValidator: SuccessfulResponseValidator = null;

    beforeEach(() => {
        intentValidator = new DefaultIntentValidator();
        dataAdapter = new InMemoryDataAdapter();
        responseValidator = new SuccessfulResponseValidator();

        idempotencyService = new IdempotencyService({
            idempotencyKeyHeader: 'idempotency-key',
            intentValidator,
            dataAdapter,
            responseValidator,
        });
    });

    afterEach(() => {
        sinon.restore();
    });

    it('pass through the request without alteration if no idempotency key', async () => {
        const { req, res } = httpMocks.createMocks();
        const nextSpy = sinon.spy();

        await idempotencyService.provideMiddlewareFunction(req, res, nextSpy);
        assert.isFalse(idempotencyService.isHit(req));
        assert.isTrue(nextSpy.called);
    });

    it('returns same response for same idempotency key', async () => {
        const originalReq = createRequest();

        // First request, which generate a idempotency resource
        const firstReq = createCloneRequest(originalReq);
        const firstRes = httpMocks.createResponse();
        const firstNextSpy = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(
            firstReq,
            firstRes,
            firstNextSpy
        );
        assert.isTrue(firstNextSpy.called);
        const value = faker.random.word();
        // Simulate route. When calling res.json, it will call eventually writeHead and send.
        firstRes.writeHead(200, null, { 'content-type': 'application/json' });
        firstRes.send('test');

        // Intermediate request, which should generate a conflict
        // because the first one is not completed
        const conflictReq = createCloneRequest(originalReq);
        const conflictRes = httpMocks.createResponse();
        const conflictNextSpy = sinon.spy();
        try {
            await idempotencyService.provideMiddlewareFunction(
                conflictReq,
                conflictRes,
                conflictNextSpy
            );
            assert.fail('Expected conflict error');
        } catch (err) {
            assert.ok(err);
        }

        // Second request
        // Must wait to allow node to handle message which came from the first request
        await wait(1);
        // Now, the idempotency response is available
        const secondReq = createCloneRequest(originalReq);
        const secondRes = httpMocks.createResponse();
        const secondNextSpy = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(
            secondReq,
            secondRes,
            secondNextSpy
        );
        assert.isTrue(secondNextSpy.called);
        assert.isTrue(idempotencyService.isHit(secondReq));
        assert.equal(secondRes._getData(), 'test');
    });

    it('removes resource if error reported', async () => {
        const req = createRequest();

        const nextFunc = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            nextFunc
        );
        assert.isTrue(nextFunc.called);
        idempotencyService.reportError(req);
        await wait(1);

        try {
            await idempotencyService.provideMiddlewareFunction(
                req,
                httpMocks.createResponse(),
                sinon.mock()
            );
            assert.isFalse(idempotencyService.isHit(req));
        } catch (err) {
            assert.fail('Expected not to throw any error.');
        }
    });

    it('indicates misuse of the idempotency key', async () => {
        const idempotencyKey = faker.random.uuid();
        const req1 = httpMocks.createRequest({
            url: 'https://something',
            method: 'POST',
            headers: {
                'idempotency-key': idempotencyKey,
            },
        });
        const req2 = httpMocks.createRequest({
            url: 'https://something-else',
            method: 'POST',
            headers: {
                'idempotency-key': idempotencyKey,
            },
        });

        await idempotencyService.provideMiddlewareFunction(
            req1,
            httpMocks.createResponse(),
            sinon.spy()
        );
        await wait(1);
        try {
            await idempotencyService.provideMiddlewareFunction(
                req2,
                httpMocks.createResponse(),
                sinon.spy()
            );
            assert.fail('Expected error thrown for idempotency key misuse');
        } catch (err) {
            assert.ok(err);
        }
    });

    it('ignores response if not valid for persistence', async () => {
        const req = createRequest();
        let res = httpMocks.createResponse();
        const persistanceValidationStud = sinon
            .stub(responseValidator, 'isValidForPersistence')
            .returns(false);

        await idempotencyService.provideMiddlewareFunction(
            req,
            res,
            sinon.mock()
        );
        res.writeHead(200);
        res.send('something');

        // Be sure that there is no hit from the previous request
        await wait(1);
        res = httpMocks.createResponse();
        await idempotencyService.provideMiddlewareFunction(
            req,
            res,
            sinon.mock()
        );
        assert.isFalse(idempotencyService.isHit(req));
    });

    it('handles correctly error while persisting resource', async () => {
        const req = createRequest();
        const res = httpMocks.createResponse();
        const dataAdapterStub = sinon
            .stub(dataAdapter, 'delete')
            .throws('Doh!');
        const persistanceValidationStud = sinon
            .stub(responseValidator, 'isValidForPersistence')
            .returns(false);

        try {
            await idempotencyService.provideMiddlewareFunction(
                req,
                res,
                sinon.mock()
            );
            res.writeHead(200);
            res.send('something');
            await wait(1);
            assert.fail('Expected error to be thrown');
        } catch (err) {
            assert.ok(err);
        }

        try {
            await idempotencyService.provideMiddlewareFunction(
                req,
                res,
                sinon.mock()
            );
            await idempotencyService.reportError(req);
            assert.fail('Expected error to be thrown');
        } catch (err) {
            assert.ok(err);
        }
    });
});

function createRequest(): express.Request {
    return httpMocks.createRequest({
        url: faker.internet.url(),
        method: faker.random.arrayElement(['GET', 'POST', 'PUT', 'DELETE']),
        headers: {
            'idempotency-key': faker.random.uuid(),
        },
    });
}

function createCloneRequest(req: express.Request): express.Request {
    return httpMocks.createRequest({
        url: req.url,
        method: req.method as httpMocks.RequestMethod,
        headers: req.headers,
    });
}

async function wait(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
