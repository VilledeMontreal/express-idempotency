import { DefaultIntentValidator } from './../defaults/defaultIntentValidator';
import { InMemoryDataAdapter } from './../defaults/inMemoryDataAdapter';
import { SuccessfulResponseValidator } from './../defaults/successfulResponseValidator';
import { assert } from 'chai';
import { faker } from '@faker-js/faker';
import {
    IdempotencyResource,
    IdempotencyRequest,
    IdempotencyResponse,
} from '../models/models';
import * as httpMocks from 'node-mocks-http';
import { IdempotencyService } from './idempotencyService';
import * as express from 'express';
import sinon from 'sinon';
import * as HttpStatus from 'http-status-codes';

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
        // Simulate route. When calling res.json, it will call eventually send.
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
        const idempotencyKey = faker.string.uuid();
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
        method: faker.helpers.arrayElement(['GET', 'POST', 'PUT', 'DELETE']),
        headers: {
            'idempotency-key': faker.string.uuid(),
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

describe('Idempotency service — processingTimeout (lease/takeover)', () => {
    let dataAdapter: InMemoryDataAdapter = null;
    let responseValidator: SuccessfulResponseValidator = null;

    afterEach(() => {
        sinon.restore();
    });

    function makeService(processingTimeout?: number): IdempotencyService {
        dataAdapter = new InMemoryDataAdapter();
        responseValidator = new SuccessfulResponseValidator();
        return new IdempotencyService({
            idempotencyKeyHeader: 'idempotency-key',
            intentValidator: new DefaultIntentValidator(),
            dataAdapter,
            responseValidator,
            processingTimeout,
        });
    }

    it('regression: no processingTimeout — in-progress resource returns 409', async () => {
        const svc = makeService();
        const req = createRequest();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        const conflictNext = sinon.spy();
        const conflictRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            conflictRes,
            conflictNext
        );

        assert.isTrue(conflictNext.calledOnce);
        assert.equal(conflictRes.statusCode, HttpStatus.CONFLICT);
    });

    it('age within timeout — in-progress resource still returns 409', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        // Advance time but stay under timeout
        clock.tick(3000);

        const conflictNext = sinon.spy();
        const conflictRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            conflictRes,
            conflictNext
        );

        assert.equal(conflictRes.statusCode, HttpStatus.CONFLICT);
    });

    it('age exceeds timeout — takeover: next called, isHit false, response cached for third request', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const originalReq = createRequest();

        // First request: creates the resource but never sends a response
        await svc.provideMiddlewareFunction(
            createCloneRequest(originalReq),
            httpMocks.createResponse(),
            sinon.spy()
        );

        // Advance past timeout
        clock.tick(6000);

        // Takeover request
        const takeoverNext = sinon.spy();
        const takeoverRes = httpMocks.createResponse();
        const takeoverReq = createCloneRequest(originalReq);
        await svc.provideMiddlewareFunction(
            takeoverReq,
            takeoverRes,
            takeoverNext
        );

        assert.isTrue(takeoverNext.calledOnce);
        assert.isFalse(svc.isHit(takeoverReq));

        // Takeover sends its response
        takeoverRes.send('takeover-body');
        await wait(1);

        // Third request: should replay the cached response
        const replayReq = createCloneRequest(originalReq);
        const replayRes = httpMocks.createResponse();
        const replayNext = sinon.spy();
        await svc.provideMiddlewareFunction(replayReq, replayRes, replayNext);

        assert.isTrue(replayNext.calledOnce);
        assert.isTrue(svc.isHit(replayReq));
        assert.equal(replayRes._getData(), 'takeover-body');
    });

    it('resource without createdAt (legacy adapter) — returns 409 even if timeout enabled', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();

        // Stub findByIdempotencyKey to return a resource without createdAt
        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
        };
        stubFind.onFirstCall().resolves(null); // create path
        stubFind.resolves(fakeResource); // subsequent reads return resource without createdAt
        const stubCreate = sinon.stub(dataAdapter, 'create').resolves();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        clock.tick(10000);

        const conflictNext = sinon.spy();
        const conflictRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            conflictRes,
            conflictNext
        );

        assert.equal(conflictRes.statusCode, HttpStatus.CONFLICT);
    });

    it('createdAt as epoch ms — expiry computed correctly', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();

        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
            createdAt: Date.now(), // numeric epoch
        };
        stubFind.onFirstCall().resolves(null);
        stubFind.resolves(fakeResource);
        sinon.stub(dataAdapter, 'create').resolves();
        sinon.stub(dataAdapter, 'delete').resolves();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );
        clock.tick(6000);

        const takeoverNext = sinon.spy();
        const takeoverReq = createCloneRequest(req);
        await svc.provideMiddlewareFunction(
            takeoverReq,
            httpMocks.createResponse(),
            takeoverNext
        );

        assert.isTrue(takeoverNext.calledOnce);
        assert.isFalse(svc.isHit(takeoverReq));
    });

    it('createdAt as ISO string — expiry computed correctly', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();

        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
            createdAt: new Date().toISOString() as any, // string from JSON round-trip
        };
        stubFind.onFirstCall().resolves(null);
        stubFind.resolves(fakeResource);
        sinon.stub(dataAdapter, 'create').resolves();
        sinon.stub(dataAdapter, 'delete').resolves();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );
        clock.tick(6000);

        const takeoverNext = sinon.spy();
        const takeoverReq = createCloneRequest(req);
        await svc.provideMiddlewareFunction(
            takeoverReq,
            httpMocks.createResponse(),
            takeoverNext
        );

        assert.isTrue(takeoverNext.calledOnce);
        assert.isFalse(svc.isHit(takeoverReq));
    });

    it('createdAt non-parseable (garbage string) — no takeover, returns 409', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();

        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
            createdAt: 'not-a-date' as any,
        };
        stubFind.onFirstCall().resolves(null);
        stubFind.resolves(fakeResource);
        sinon.stub(dataAdapter, 'create').resolves();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        // Advance well past timeout — parseCreatedAt returns null for garbage string
        // so isLeaseExpired returns false and the behaviour is 409, not a takeover.
        clock.tick(10000);

        const conflictNext = sinon.spy();
        const conflictRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            conflictRes,
            conflictNext
        );

        assert.equal(conflictRes.statusCode, HttpStatus.CONFLICT);
        assert.isTrue(conflictNext.calledOnce);
    });

    it('create throws at takeover — falls back to 409 with no unhandled rejection', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        clock.tick(6000);

        // Make create throw to simulate lost race condition
        sinon.stub(dataAdapter, 'create').rejects(new Error('Duplicate'));

        const fallbackNext = sinon.spy();
        const fallbackRes = httpMocks.createResponse();
        const fallbackReq = createCloneRequest(req);

        // Must not throw / produce unhandled rejection
        await svc.provideMiddlewareFunction(
            fallbackReq,
            fallbackRes,
            fallbackNext
        );

        assert.isTrue(fallbackNext.calledOnce);
        assert.equal(fallbackRes.statusCode, HttpStatus.CONFLICT);
    });

    it('lease expired + intent divergent — returns 417, no takeover', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const idempotencyKey = faker.string.uuid();

        const req1 = httpMocks.createRequest({
            url: 'https://endpoint-a',
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey },
        });
        const req2 = httpMocks.createRequest({
            url: 'https://endpoint-b',
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey },
        });

        await svc.provideMiddlewareFunction(
            req1,
            httpMocks.createResponse(),
            sinon.spy()
        );
        clock.tick(6000);

        const deleteSpy = sinon.spy(dataAdapter, 'delete');
        const intentNext = sinon.spy();
        const intentRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(req2, intentRes, intentNext);

        assert.equal(intentRes.statusCode, HttpStatus.EXPECTATION_FAILED);
        assert.isFalse(
            deleteSpy.called,
            'delete should not be called for intent mismatch'
        );
    });

    it('zombie guard: late send after takeover — does not overwrite new resource', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const originalReq = createRequest();

        // First request: sets up hook but never sends
        const firstRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(
            createCloneRequest(originalReq),
            firstRes,
            sinon.spy()
        );

        const updateSpy = sinon.spy(dataAdapter, 'update');

        // Advance past timeout, takeover
        clock.tick(6000);
        const takeoverRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(
            createCloneRequest(originalReq),
            takeoverRes,
            sinon.spy()
        );
        takeoverRes.send('takeover-body');
        await wait(1);

        // Original (zombie) finally sends — should NOT call update on the new resource
        const updateCallsBefore = updateSpy.callCount;
        firstRes.send('zombie-body');
        await wait(1);

        assert.equal(
            updateSpy.callCount,
            updateCallsBefore,
            'zombie must not call update'
        );

        // Third request should still replay the takeover body
        const replayReq = createCloneRequest(originalReq);
        const replayRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(replayReq, replayRes, sinon.spy());
        assert.equal(replayRes._getData(), 'takeover-body');
    });

    it('zombie guard: late send without takeover (timeout disabled) — response is persisted normally', async () => {
        const svc = makeService(); // no timeout
        const req = createRequest();
        const res = httpMocks.createResponse();

        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            res,
            sinon.spy()
        );

        const updateSpy = sinon.spy(dataAdapter, 'update');
        res.send('late-body');
        await wait(1);

        assert.isTrue(updateSpy.calledOnce);
    });
});
