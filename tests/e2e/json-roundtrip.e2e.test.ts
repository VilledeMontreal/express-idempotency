// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { assert } from 'chai';
import * as express from 'express';
import { buildApp } from './harness/buildApp';
import { startServer } from './harness/server';
import { genKey } from './harness/helpers';
import { runIdempotencySuite } from './harness/scenarios';
import { JsonRoundTripDataAdapter } from './harness/jsonRoundTripDataAdapter';
import { DefaultIntentValidator } from '../../src/defaults/defaultIntentValidator';
import { IdempotencyRequest } from '../../src/models/models';

describe('JsonRoundTripDataAdapter (serialising store) over real HTTP', () => {
    runIdempotencySuite((options) =>
        buildApp({ dataAdapter: new JsonRoundTripDataAdapter(), ...options })
    );
});

describe('Intent validation against a serialised request on Express 5 (#51)', () => {
    // Records the prototype of the live req.query seen by the validator, to
    // prove the scenario really exercises a null-prototype query.
    class RecordingIntentValidator extends DefaultIntentValidator {
        public queryPrototypes: (object | null)[] = [];

        isValidIntent(
            req: express.Request,
            idempotencyRequest: IdempotencyRequest
        ): boolean {
            this.queryPrototypes.push(Object.getPrototypeOf(req.query));
            return super.isValidIntent(req, idempotencyRequest);
        }
    }

    let validator: RecordingIntentValidator;
    let built: ReturnType<typeof buildApp>;
    let ctx: Awaited<ReturnType<typeof startServer>>;

    beforeEach(async () => {
        validator = new RecordingIntentValidator();
        built = buildApp({
            dataAdapter: new JsonRoundTripDataAdapter(),
            intentValidator: validator,
        });
        ctx = await startServer(built.app);
    });

    afterEach(async () => {
        built.controls.releaseAll();
        await ctx.close();
    });

    it('replays (200, no 417) a retry carrying query parameters', async () => {
        const key = genKey();
        const path = '/resource?param1=a&param2=b';
        const r1 = await ctx.request({ path, key });
        const r2 = await ctx.request({ path, key });
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
        assert.deepEqual(r2.body, r1.body);
        assert.equal(built.controls.count('/resource'), 1);
        assert.deepEqual(validator.queryPrototypes, [null]);
    });

    it('replays (200, no 417) a retry with an empty query', async () => {
        const key = genKey();
        const r1 = await ctx.request({ path: '/resource', key });
        const r2 = await ctx.request({ path: '/resource', key });
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
        assert.deepEqual(r2.body, r1.body);
        assert.equal(built.controls.count('/resource'), 1);
        assert.deepEqual(validator.queryPrototypes, [null]);
    });

    it('replays (200, no 417) a retry carrying a JSON body', async () => {
        const key = genKey();
        const body = { a: 1, nested: { b: ['x', 'y'] } };
        const r1 = await ctx.request({
            path: '/resource',
            method: 'POST',
            key,
            body,
        });
        const r2 = await ctx.request({
            path: '/resource',
            method: 'POST',
            key,
            body,
        });
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
        assert.equal(built.controls.count('/resource'), 1);
    });

    it('still rejects (417) a retry whose URL (query string included) differs', async () => {
        const key = genKey();
        const r1 = await ctx.request({ path: '/resource?param1=a', key });
        const r2 = await ctx.request({ path: '/resource?param1=b', key });
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 417);
    });
});
