// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { assert } from 'chai';
import { buildApp } from './harness/buildApp';
import { makeControls } from './harness/controls';
import { startServer } from './harness/server';
import { genKey, waitUntil } from './harness/helpers';
import { runIdempotencySuite } from './harness/scenarios';

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
