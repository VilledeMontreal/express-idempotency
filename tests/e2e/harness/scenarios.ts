// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { assert } from 'chai';
import { IdempotencyOptions } from '../../../src/models/models';
import { BuiltApp } from './buildApp';
import { startServer, RunningServer } from './server';
import { genKey, wait, waitUntil, concurrent } from './helpers';

/**
 * Run the full idempotency behavioural suite against a given app factory.
 * Reusable across data adapters: pass a factory that injects another adapter
 * (e.g. a MongoDB adapter) to replay the exact same guarantees over real HTTP.
 */
export function runIdempotencySuite(
    makeApp: (options?: IdempotencyOptions) => BuiltApp
): void {
    describe('express-idempotency e2e behaviour', () => {
        let built: BuiltApp | undefined;
        let ctx: RunningServer | undefined;

        async function start(options?: IdempotencyOptions): Promise<void> {
            built = makeApp(options);
            ctx = await startServer(built.app);
        }

        afterEach(async () => {
            // Release any handler still parked on a gate, then close the server,
            // so a failing assertion never leaves the process hanging.
            built?.controls.releaseAll();
            if (ctx) {
                await ctx.close();
            }
            built = undefined;
            ctx = undefined;
        });

        it('S0 — passes requests through untouched when no idempotency key is present', async () => {
            await start();
            const r1 = await ctx.request({ path: '/resource' });
            const r2 = await ctx.request({ path: '/resource' });
            assert.equal(r1.status, 200);
            assert.equal(r2.status, 200);
            // No key => no idempotency: each request is processed independently.
            assert.notDeepEqual(r2.body, r1.body);
            assert.equal(built.controls.count('/resource'), 2);
        });

        it('S1 — processes a first request normally', async () => {
            await start();
            const key = genKey();
            const r = await ctx.request({ path: '/resource', key });
            assert.equal(r.status, 200);
            assert.equal(r.body.callCount, 1);
            assert.equal(built.controls.count('/resource'), 1);
        });

        it('S2 — replays the cached response on retry (hit, no re-execution)', async () => {
            await start();
            const key = genKey();
            const r1 = await ctx.request({ path: '/resource', key });
            const r2 = await ctx.request({ path: '/resource', key });
            assert.equal(r1.status, 200);
            assert.equal(r2.status, 200);
            assert.deepEqual(r2.body, r1.body);
            assert.equal(built.controls.count('/resource'), 1);
        });

        it('S3 — returns 409 while a request is still in progress', async () => {
            await start();
            const key = genKey();
            const pA = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 1);
            const rB = await ctx.request({ path: '/slow', key });
            assert.equal(rB.status, 409);
            built.controls.release('/slow#1');
            const rA = await pA;
            assert.equal(rA.status, 200);
            assert.equal(built.controls.count('/slow'), 1);
        });

        it('S4 — concurrent retries against an in-progress request all get 409', async () => {
            await start();
            const key = genKey();
            const pA = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 1);
            const retries = await concurrent(4, () =>
                ctx.request({ path: '/slow', key })
            );
            for (const r of retries) {
                assert.equal(r.status, 'fulfilled');
                if (r.status === 'fulfilled') {
                    assert.equal(r.value.status, 409);
                }
            }
            built.controls.release('/slow#1');
            const rA = await pA;
            assert.equal(rA.status, 200);
            assert.equal(built.controls.count('/slow'), 1);
        });

        it('S5 — takes over an orphaned request after processingTimeout (no hit), then replays the takeover response and guards against the zombie write', async () => {
            await start({ processingTimeout: 250 });
            const key = genKey();
            // A: in-progress, deliberately not released before the lease expires.
            const pA = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 1);
            await wait(400); // exceed the 250ms lease
            // B: takes over -> handler re-executes (instance 2), not a hit.
            const pB = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 2);
            built.controls.release('/slow#2');
            const rB = await pB;
            assert.equal(rB.status, 200);
            assert.equal(rB.body.instance, 2);
            assert.equal(built.controls.count('/slow'), 2);
            // C: replay of B's response (hit), no third execution.
            const rC = await ctx.request({ path: '/slow', key });
            assert.equal(rC.status, 200);
            assert.deepEqual(rC.body, rB.body);
            assert.equal(built.controls.count('/slow'), 2);
            // Zombie guard: releasing A after the takeover must not overwrite B.
            built.controls.release('/slow#1');
            await pA.catch(() => undefined);
            const rC2 = await ctx.request({ path: '/slow', key });
            assert.deepEqual(rC2.body, rB.body);
            assert.equal(built.controls.count('/slow'), 2);
        });

        it('S6 — returns 409 (no takeover) before processingTimeout elapses', async () => {
            await start({ processingTimeout: 250 });
            const key = genKey();
            const pA = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 1);
            await wait(80); // still within the 250ms lease
            const rB = await ctx.request({ path: '/slow', key });
            assert.equal(rB.status, 409);
            built.controls.release('/slow#1');
            await pA;
        });

        it('S7 — cleans up a phantom key when the response bypasses res.send', async () => {
            await start();
            const key = genKey();
            const r1 = await ctx.request({ path: '/raw-end', key });
            assert.equal(r1.status, 200);
            assert.equal(r1.body, 'raw');
            // The finish handler deletes the orphaned resource asynchronously.
            await waitUntil(() => built.controls.wasDeleted(key));
            const r2 = await ctx.request({ path: '/raw-end', key });
            assert.equal(r2.status, 200);
            assert.equal(built.controls.count('/raw-end'), 2);
        });

        it('S8 — rejects a reused key with a different intent (417)', async () => {
            await start();
            const key = genKey();
            const r1 = await ctx.request({
                method: 'POST',
                path: '/resource',
                key,
                body: { a: 1 },
            });
            assert.equal(r1.status, 200);
            const r2 = await ctx.request({
                method: 'POST',
                path: '/resource',
                key,
                body: { a: 2 },
            });
            assert.equal(r2.status, 417);
        });

        it('S9 — reportError releases the key for reprocessing', async () => {
            await start();
            const key = genKey();
            const r1 = await ctx.request({ path: '/boom', key });
            assert.equal(r1.status, 500);
            await waitUntil(() => built.controls.wasDeleted(key));
            const r2 = await ctx.request({ path: '/resource', key });
            assert.equal(r2.status, 200);
            assert.equal(built.controls.count('/resource'), 1);
        });

        it('S10 — without processingTimeout, an orphaned request stays 409 (v2.0.0 behaviour)', async () => {
            await start(); // no processingTimeout
            const key = genKey();
            const pA = ctx.request({ path: '/slow', key });
            await waitUntil(() => built.controls.count('/slow') >= 1);
            await wait(300); // well beyond any would-be timeout
            const rB = await ctx.request({ path: '/slow', key });
            assert.equal(rB.status, 409);
            built.controls.release('/slow#1');
            await pA;
        });
    });
}
