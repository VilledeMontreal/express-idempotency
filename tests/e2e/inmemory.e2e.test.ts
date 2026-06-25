// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { assert } from 'chai';
import { buildApp } from './harness/buildApp';
import { makeControls } from './harness/controls';
import { startServer } from './harness/server';
import { genKey, waitUntil } from './harness/helpers';
import { runIdempotencySuite } from './harness/scenarios';
import { InMemoryDataAdapter } from '../../src/defaults/inMemoryDataAdapter';

describe('InMemoryDataAdapter (default) over real HTTP', () => {
    runIdempotencySuite((options) => buildApp(options));
});

describe('InMemoryDataAdapter — error status without a custom error handler (#34)', () => {
    it('surfaces a native 409 for an in-progress conflict even when no Express error handler is registered', async () => {
        // The idempotency errors carry their status code, so Express derives
        // 409/417 natively (via finalhandler) without the reference handler.
        const built = buildApp({}, makeControls(), { withErrorHandler: false });
        const ctx = await startServer(built.app);
        try {
            const key = genKey();
            const pA = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 1);
            const rB = await ctx.request({ path: '/slow', key });
            assert.equal(rB.status, 409);
            built.controls.release('/slow#1');
            const rA = await pA;
            assert.equal(rA.status, 200);
        } finally {
            built.controls.releaseAll();
            await ctx.close();
        }
    });
});

describe('Request header filtering at rest over real HTTP (#36)', () => {
    // Inspect what the data adapter actually stored, proving secrets never reach
    // persistence. A reference to the inner adapter is kept so the persisted
    // resource can be read back through the public findByIdempotencyKey API.
    it('persists only the default-whitelisted content-type, never Authorization/Cookie', async () => {
        const adapter = new InMemoryDataAdapter();
        const built = buildApp({ dataAdapter: adapter });
        const ctx = await startServer(built.app);
        try {
            const key = genKey();
            const r = await ctx.request({
                path: '/resource',
                method: 'POST',
                key,
                body: { hello: 'world' }, // sets content-type: application/json
                headers: {
                    authorization: 'Bearer e2e-super-secret',
                    cookie: 'session=should-not-persist',
                },
            });
            assert.equal(r.status, 200);

            const stored = await adapter.findByIdempotencyKey(key);
            assert.deepEqual(stored.request.headers, {
                'content-type': 'application/json',
            });
            assert.notProperty(stored.request.headers, 'authorization');
            assert.notProperty(stored.request.headers, 'cookie');
        } finally {
            built.controls.releaseAll();
            await ctx.close();
        }
    });

    it('persists exactly the configured custom whitelist (case-insensitive)', async () => {
        const adapter = new InMemoryDataAdapter();
        const built = buildApp({
            dataAdapter: adapter,
            requestHeaderWhitelist: ['X-Keep'],
        });
        const ctx = await startServer(built.app);
        try {
            const key = genKey();
            const r = await ctx.request({
                path: '/resource',
                method: 'POST',
                key,
                headers: {
                    authorization: 'Bearer e2e-super-secret',
                    'x-keep': 'kept-value',
                },
            });
            assert.equal(r.status, 200);

            const stored = await adapter.findByIdempotencyKey(key);
            assert.deepEqual(stored.request.headers, {
                'x-keep': 'kept-value',
            });
            assert.notProperty(stored.request.headers, 'authorization');
        } finally {
            built.controls.releaseAll();
            await ctx.close();
        }
    });
});
