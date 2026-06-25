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
import {
    IdempotencyConflictError,
    IdempotencyIntentMismatchError,
} from '../errors/idempotencyErrors';
import * as express from 'express';
import sinon from 'sinon';
import * as HttpStatus from 'http-status-codes';
import { EventEmitter } from 'events';

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

        // First request, which generates an idempotency resource (in progress).
        const firstReq = createCloneRequest(originalReq);
        const firstRes = httpMocks.createResponse();
        const firstNextSpy = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(
            firstReq,
            firstRes,
            firstNextSpy
        );
        assert.isTrue(firstNextSpy.called);

        // Intermediate request while the first is still in progress -> 409.
        const conflictReq = createCloneRequest(originalReq);
        const conflictRes = httpMocks.createResponse();
        const conflictNextSpy = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(
            conflictReq,
            conflictRes,
            conflictNextSpy
        );
        assert.isTrue(conflictNextSpy.calledOnce);
        assert.equal(conflictRes.statusCode, HttpStatus.CONFLICT);
        assert.instanceOf(
            conflictNextSpy.firstCall.args[0],
            IdempotencyConflictError
        );

        // First request now completes by sending its response.
        firstRes.send('test');

        // Second request: wait so the persisted response becomes available.
        await wait(1);
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
        await idempotencyService.reportError(req);
        await wait(1);

        // After reportError the key is released: the retry is reprocessed
        // (not a hit) and no error is propagated to next.
        const retryNext = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            retryNext
        );
        assert.isTrue(retryNext.calledOnce);
        assert.isUndefined(retryNext.firstCall.args[0]);
        assert.isFalse(idempotencyService.isHit(req));
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

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await idempotencyService.provideMiddlewareFunction(req2, res, next);

        assert.isTrue(next.calledOnce);
        assert.equal(res.statusCode, HttpStatus.EXPECTATION_FAILED);
        assert.instanceOf(
            next.firstCall.args[0],
            IdempotencyIntentMismatchError
        );
    });

    it('ignores response if not valid for persistence', async () => {
        const req = createRequest();
        let res = httpMocks.createResponse();
        sinon.stub(responseValidator, 'isValidForPersistence').returns(false);

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

    it('handles a persistence error gracefully without crashing the middleware', async () => {
        const req = createRequest();
        const res = httpMocks.createResponse();
        sinon.stub(dataAdapter, 'delete').rejects(new Error('Doh!'));
        sinon.stub(responseValidator, 'isValidForPersistence').returns(false);
        const warnSpy = sinon.stub(console, 'warn');

        // The middleware resolves and calls next; the failed cleanup is
        // swallowed by the fire-and-forget hook (only logged).
        const next = sinon.spy();
        await idempotencyService.provideMiddlewareFunction(req, res, next);
        res.send('something');
        await wait(1);

        assert.isTrue(next.calledOnce);
        assert.isTrue(
            warnSpy.called,
            'the persistence failure should be logged'
        );

        // reportError surfaces the adapter failure to its caller.
        let rejected = false;
        try {
            await idempotencyService.reportError(req);
        } catch {
            rejected = true;
        }
        assert.isTrue(
            rejected,
            'reportError should reject when the adapter fails'
        );
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

    it('cached response is replayed after the lease expires — a completed resource is never taken over', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const originalReq = createRequest();

        // First request creates the resource and persists its response.
        const firstReq = createCloneRequest(originalReq);
        const firstRes = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(firstReq, firstRes, sinon.spy());
        firstRes.send('cached-body');
        await wait(1);

        // Advance well past the processing timeout. The resource is complete (a
        // response is cached), so it is NOT an orphan: the retry must replay the
        // cached response, never take over and reprocess the request.
        clock.tick(60000);

        const replayReq = createCloneRequest(originalReq);
        const replayRes = httpMocks.createResponse();
        const replayNext = sinon.spy();
        await svc.provideMiddlewareFunction(replayReq, replayRes, replayNext);

        assert.isTrue(replayNext.calledOnce);
        assert.isTrue(svc.isHit(replayReq));
        assert.equal(replayRes.statusCode, HttpStatus.OK);
        assert.equal(replayRes._getData(), 'cached-body');
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

    it('create lost-race at takeover — re-fetch finds a winner, returns 409', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
            createdAt: Date.now(),
        };

        // find #1 → expired resource (triggers takeover);
        // find #2 → re-fetch after the failed create still finds a resource,
        // proving a concurrent request won the unique-key constraint.
        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        stubFind.resolves(fakeResource);
        sinon.stub(dataAdapter, 'delete').resolves();
        sinon.stub(dataAdapter, 'create').rejects(new Error('Duplicate'));

        clock.tick(6000); // lease expires

        const next = sinon.spy();
        const res = httpMocks.createResponse();

        // Must not throw / produce an unhandled rejection
        await svc.provideMiddlewareFunction(req, res, next);

        assert.isTrue(next.calledOnce);
        assert.equal(res.statusCode, HttpStatus.CONFLICT);
        assert.instanceOf(next.firstCall.args[0], IdempotencyConflictError);
    });

    it('create fails at takeover with no winner — propagates the adapter error (not 409)', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
            createdAt: Date.now(),
        };
        const adapterError = new Error('adapter down');

        // find #1 → expired resource (takeover); find #2 (re-fetch) → null,
        // i.e. a genuine adapter outage rather than a race.
        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        stubFind.onFirstCall().resolves(fakeResource);
        stubFind.onSecondCall().resolves(null);
        sinon.stub(dataAdapter, 'delete').resolves();
        sinon.stub(dataAdapter, 'create').rejects(adapterError);

        clock.tick(6000);

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(req, res, next);

        assert.isTrue(next.calledOnce);
        assert.strictEqual(next.firstCall.args[0], adapterError);
        assert.notInstanceOf(next.firstCall.args[0], IdempotencyConflictError);
        assert.notEqual(res.statusCode, HttpStatus.CONFLICT);
    });

    it('delete failure at takeover — propagates the adapter error to next(err)', async () => {
        const clock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ['Date'],
        });
        const svc = makeService(5000);
        const req = createRequest();
        const fakeResource: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
            createdAt: Date.now(),
        };
        const deleteError = new Error('delete failed');
        sinon.stub(dataAdapter, 'findByIdempotencyKey').resolves(fakeResource);
        sinon.stub(dataAdapter, 'delete').rejects(deleteError);

        clock.tick(6000); // lease expires -> takeover attempts the delete

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(req, res, next);

        assert.isTrue(next.calledOnce);
        assert.strictEqual(next.firstCall.args[0], deleteError);
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

describe('Idempotency service — finish hook (res.end bypass)', () => {
    let dataAdapter: InMemoryDataAdapter = null;

    afterEach(() => {
        sinon.restore();
    });

    function makeService(): IdempotencyService {
        dataAdapter = new InMemoryDataAdapter();
        return new IdempotencyService({
            idempotencyKeyHeader: 'idempotency-key',
            intentValidator: new DefaultIntentValidator(),
            dataAdapter,
            responseValidator: new SuccessfulResponseValidator(),
        });
    }

    it('res.end without res.send — resource deleted, warn emitted, next request reprocessed', async () => {
        const svc = makeService();
        const req = createRequest();

        // EventEmitter is required for node-mocks-http to emit the finish event
        const res = httpMocks.createResponse({ eventEmitter: EventEmitter });
        const warnSpy = sinon.stub(console, 'warn');
        const deleteSpy = sinon.spy(dataAdapter, 'delete');

        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            res,
            sinon.spy()
        );

        // Simulate res.end() — bypasses the monkey-patched res.send
        res.end();
        await wait(1);

        assert.isTrue(warnSpy.called, 'console.warn should be called');
        assert.isTrue(deleteSpy.calledOnce, 'resource should be deleted');

        // Next request with same key must be reprocessed (not 409)
        const retryNext = sinon.spy();
        const retryReq = createCloneRequest(req);
        await svc.provideMiddlewareFunction(
            retryReq,
            httpMocks.createResponse(),
            retryNext
        );

        assert.isTrue(retryNext.calledOnce);
        assert.isFalse(
            svc.isHit(retryReq),
            'retry should not be a hit — it must be reprocessed'
        );
    });

    it('finish after res.send — update called once, delete not called, no warn', async () => {
        const svc = makeService();
        const req = createRequest();

        const res = httpMocks.createResponse({ eventEmitter: EventEmitter });
        const warnSpy = sinon.stub(console, 'warn');
        const updateSpy = sinon.spy(dataAdapter, 'update');
        const deleteSpy = sinon.spy(dataAdapter, 'delete');

        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            res,
            sinon.spy()
        );

        // Normal path: res.send triggers the monkey-patch, then finish fires
        res.send('body');
        await wait(1);

        assert.isTrue(updateSpy.calledOnce, 'update should be called once');
        assert.isFalse(deleteSpy.called, 'delete should not be called');
        assert.isFalse(
            warnSpy.called,
            'warn should not be emitted on normal send path'
        );
    });
});

describe('Idempotency service — error typing, async guard & hit spoofing (#33/#34/#35)', () => {
    let dataAdapter: InMemoryDataAdapter = null;

    afterEach(() => {
        sinon.restore();
    });

    function makeService(): IdempotencyService {
        dataAdapter = new InMemoryDataAdapter();
        return new IdempotencyService({
            idempotencyKeyHeader: 'idempotency-key',
            intentValidator: new DefaultIntentValidator(),
            dataAdapter,
            responseValidator: new SuccessfulResponseValidator(),
        });
    }

    // #34 — conflicts and intent mismatches carry HTTP status metadata.
    it('intent mismatch surfaces a 417 IdempotencyIntentMismatchError', async () => {
        const svc = makeService();
        const key = faker.string.uuid();
        const req1 = httpMocks.createRequest({
            url: 'https://endpoint-a',
            method: 'POST',
            headers: { 'idempotency-key': key },
        });
        const req2 = httpMocks.createRequest({
            url: 'https://endpoint-b',
            method: 'POST',
            headers: { 'idempotency-key': key },
        });

        await svc.provideMiddlewareFunction(
            req1,
            httpMocks.createResponse(),
            sinon.spy()
        );
        await wait(1);

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(req2, res, next);

        assert.isTrue(next.calledOnce);
        assert.equal(res.statusCode, HttpStatus.EXPECTATION_FAILED);
        const err = next.firstCall.args[0];
        assert.instanceOf(err, IdempotencyIntentMismatchError);
        assert.equal(err.statusCode, HttpStatus.EXPECTATION_FAILED);
        assert.equal(err.status, HttpStatus.EXPECTATION_FAILED);
    });

    it('in-progress conflict surfaces a 409 IdempotencyConflictError', async () => {
        const svc = makeService();
        const req = createRequest();

        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(createCloneRequest(req), res, next);

        assert.isTrue(next.calledOnce);
        assert.equal(res.statusCode, HttpStatus.CONFLICT);
        const err = next.firstCall.args[0];
        assert.instanceOf(err, IdempotencyConflictError);
        assert.equal(err.statusCode, HttpStatus.CONFLICT);
        assert.equal(err.status, HttpStatus.CONFLICT);
    });

    // #33 — concurrent create race on the initial (no-resource) branch.
    it('initial create lost-race — re-fetch finds a winner, returns 409 (no unhandled rejection)', async () => {
        const svc = makeService();
        const req = createRequest();
        const winner: IdempotencyResource = {
            idempotencyKey: req.get('idempotency-key'),
            request: {
                url: req.url,
                method: req.method,
                body: {},
                headers: req.headers,
                query: {},
            },
        };
        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        stubFind.onFirstCall().resolves(null); // no resource → initial create branch
        stubFind.onSecondCall().resolves(winner); // re-fetch after failed create → race
        sinon.stub(dataAdapter, 'create').rejects(new Error('Duplicate'));

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(req, res, next);

        assert.isTrue(next.calledOnce);
        assert.equal(res.statusCode, HttpStatus.CONFLICT);
        assert.instanceOf(next.firstCall.args[0], IdempotencyConflictError);
    });

    it('initial create fails with no winner — propagates the adapter error', async () => {
        const svc = makeService();
        const req = createRequest();
        const adapterError = new Error('adapter down');
        const stubFind = sinon.stub(dataAdapter, 'findByIdempotencyKey');
        stubFind.onFirstCall().resolves(null);
        stubFind.onSecondCall().resolves(null);
        sinon.stub(dataAdapter, 'create').rejects(adapterError);

        const next = sinon.spy();
        const res = httpMocks.createResponse();
        await svc.provideMiddlewareFunction(req, res, next);

        assert.isTrue(next.calledOnce);
        assert.strictEqual(next.firstCall.args[0], adapterError);
        assert.notInstanceOf(next.firstCall.args[0], IdempotencyConflictError);
    });

    // #33 — adapter/validator failures are forwarded, never leaked as rejections.
    it('findByIdempotencyKey rejection is forwarded to next(err)', async () => {
        const svc = makeService();
        const req = createRequest();
        const findError = new Error('find boom');
        sinon.stub(dataAdapter, 'findByIdempotencyKey').rejects(findError);

        const next = sinon.spy();
        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            next
        );

        assert.isTrue(next.calledOnce);
        assert.strictEqual(next.firstCall.args[0], findError);
    });

    it('a throwing intent validator is forwarded to next(err)', async () => {
        const intentValidator = new DefaultIntentValidator();
        dataAdapter = new InMemoryDataAdapter();
        const svc = new IdempotencyService({
            idempotencyKeyHeader: 'idempotency-key',
            intentValidator,
            dataAdapter,
            responseValidator: new SuccessfulResponseValidator(),
        });
        const req = createRequest();

        // Seed a resource so the intent validator is reached on the retry.
        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );

        const intentError = new Error('intent boom');
        sinon.stub(intentValidator, 'isValidIntent').throws(intentError);

        const next = sinon.spy();
        await svc.provideMiddlewareFunction(
            createCloneRequest(req),
            httpMocks.createResponse(),
            next
        );

        assert.isTrue(next.calledOnce);
        assert.strictEqual(next.firstCall.args[0], intentError);
    });

    // #35 — a client cannot spoof a hit through a request header.
    it('a client-supplied x-hit header on a fresh key is ignored', async () => {
        const svc = makeService();
        const req = httpMocks.createRequest({
            url: 'https://something',
            method: 'POST',
            headers: {
                'idempotency-key': faker.string.uuid(),
                'x-hit': 'true',
            },
        });

        const next = sinon.spy();
        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            next
        );

        assert.isFalse(
            svc.isHit(req),
            'a spoofed x-hit header must not be honoured'
        );
        assert.isTrue(next.calledOnce);
    });
});

// #36 — request headers (Authorization, Cookie, API keys) must not be persisted
// at rest. Only a configurable, case-insensitive whitelist is stored.
describe('Idempotency service — request header filtering', () => {
    let dataAdapter: InMemoryDataAdapter = null;

    afterEach(() => {
        sinon.restore();
    });

    function makeService(
        requestHeaderWhitelist?: string[]
    ): IdempotencyService {
        dataAdapter = new InMemoryDataAdapter();
        return new IdempotencyService({
            idempotencyKeyHeader: 'idempotency-key',
            intentValidator: new DefaultIntentValidator(),
            dataAdapter,
            responseValidator: new SuccessfulResponseValidator(),
            requestHeaderWhitelist,
        });
    }

    // Persist a fresh resource for `key` carrying the given headers and return
    // the stored request headers. `create` runs synchronously before next(), so
    // the resource is available as soon as the middleware resolves.
    async function persistedHeaders(
        svc: IdempotencyService,
        key: string,
        headers: Record<string, string>
    ): Promise<any> {
        const req = httpMocks.createRequest({
            url: 'https://something/path',
            method: 'POST',
            headers: { 'idempotency-key': key, ...headers },
        });
        await svc.provideMiddlewareFunction(
            req,
            httpMocks.createResponse(),
            sinon.spy()
        );
        const stored = await dataAdapter.findByIdempotencyKey(key);
        return stored.request.headers;
    }

    it('persists only the default-whitelisted header (content-type) and drops secrets', async () => {
        const svc = makeService();
        const headers = await persistedHeaders(svc, 'key-default', {
            authorization: 'Bearer super-secret',
            cookie: 'session=abc',
            'content-type': 'application/json',
        });

        assert.deepEqual(headers, { 'content-type': 'application/json' });
        assert.notProperty(headers, 'authorization');
        assert.notProperty(headers, 'cookie');
        // The idempotency key header itself is not whitelisted, so it is dropped
        // too (it is never read from the persisted request).
        assert.notProperty(headers, 'idempotency-key');
    });

    it('honours a custom whitelist with case-insensitive matching', async () => {
        const svc = makeService(['Authorization', 'X-Correlation-ID']);
        const headers = await persistedHeaders(svc, 'key-custom', {
            authorization: 'Bearer token',
            'x-correlation-id': 'cid-123',
            'content-type': 'application/json',
            cookie: 'session=abc',
        });

        assert.deepEqual(headers, {
            authorization: 'Bearer token',
            'x-correlation-id': 'cid-123',
        });
        assert.notProperty(headers, 'content-type');
        assert.notProperty(headers, 'cookie');
    });

    it('persists no headers when the whitelist is empty', async () => {
        const svc = makeService([]);
        const headers = await persistedHeaders(svc, 'key-empty', {
            authorization: 'Bearer token',
            'content-type': 'application/json',
        });

        assert.deepEqual(headers, {});
    });

    it('keeps a whitelisted header even when its value is falsy (filters on keys, not values)', async () => {
        const svc = makeService(['x-empty']);
        const headers = await persistedHeaders(svc, 'key-falsy', {
            'x-empty': '',
            authorization: 'Bearer token',
        });

        assert.deepEqual(headers, { 'x-empty': '' });
        assert.notProperty(headers, 'authorization');
    });
});
