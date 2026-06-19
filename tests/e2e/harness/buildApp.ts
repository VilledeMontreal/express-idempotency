// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import express = require('express');
import { idempotency, getSharedIdempotencyService } from '../../../src/index';
import {
    IdempotencyOptions,
    IIdempotencyDataAdapter,
} from '../../../src/models/models';
import { IdempotencyService } from '../../../src/services/idempotencyService';
import { InMemoryDataAdapter } from '../../../src/defaults/inMemoryDataAdapter';
import { Controls, makeControls } from './controls';

export interface BuiltApp {
    app: express.Express;
    service: IdempotencyService;
    controls: Controls;
}

export interface BuildAppHarnessOptions {
    /**
     * Mount the reference Express error handler (default `true`). Set to `false`
     * to prove that the idempotency errors carry a status code Express derives
     * natively (`409` / `417`) even when the consumer registers no handler.
     */
    withErrorHandler?: boolean;
}

/**
 * Wrap a data adapter to record deletions through the test controls, so a test
 * can await asynchronous cleanup (phantom-key removal, reportError) via
 * `controls.wasDeleted(key)`. Every operation is delegated to the inner adapter.
 */
function traceAdapter(
    inner: IIdempotencyDataAdapter,
    controls: Controls
): IIdempotencyDataAdapter {
    return {
        findByIdempotencyKey: (key) => inner.findByIdempotencyKey(key),
        create: (resource) => inner.create(resource),
        update: (resource) => inner.update(resource),
        delete: async (key) => {
            await inner.delete(key);
            controls.recordDelete(key);
        },
    };
}

/**
 * Build a mini Express app exercising the idempotency middleware over a real
 * HTTP stack. Routes are instrumented through `controls` so tests can drive
 * conflicts, timeouts and phantom keys deterministically.
 *
 * IMPORTANT: the middleware factory mutates a process-wide singleton, so the
 * service instance is captured here and used by the handlers through closure —
 * never via getSharedIdempotencyService() inside a handler (it would return the
 * last app built, breaking isolation).
 */
export function buildApp(
    options: IdempotencyOptions = {},
    controls: Controls = makeControls(),
    harnessOptions: BuildAppHarnessOptions = {}
): BuiltApp {
    const innerAdapter = options.dataAdapter ?? new InMemoryDataAdapter();
    const dataAdapter = traceAdapter(innerAdapter, controls);

    const middleware = idempotency({ ...options, dataAdapter });
    const service = getSharedIdempotencyService();

    const app = express();
    app.use(express.json());
    app.use(middleware);

    // Normal route — exercises replay / hit / intent validation.
    app.all('/resource', (req, res) => {
        if (service.isHit(req)) {
            return;
        }
        const n = controls.bump('/resource');
        res.json({ value: String(n), callCount: n });
    });

    // Slow route — holds in-progress until released; drives 409, concurrent
    // retries, timeout takeover and the zombie guard. The gate is keyed by
    // execution index so each in-flight execution is released independently.
    app.get('/slow', async (req, res) => {
        if (service.isHit(req)) {
            return;
        }
        const n = controls.bump('/slow');
        await controls.gate(`/slow#${n}`);
        res.json({ callCount: n, instance: n });
    });

    // Bypass route — responds via res.end() without res.send(), so the
    // middleware must clean up the orphaned resource on finish (phantom key).
    app.get('/raw-end', (req, res) => {
        if (service.isHit(req)) {
            return;
        }
        controls.bump('/raw-end');
        res.status(200).end('raw');
    });

    // Failing route — reports a business error so the key is released for retry.
    app.get('/boom', async (req, res) => {
        controls.bump('/boom');
        await service.reportError(req);
        res.status(500).json({ error: 'boom' });
    });

    // Error handler: the idempotency errors carry their HTTP status on
    // `statusCode` (and `status`), so a handler should derive the code from the
    // error first — falling back to the status already set on the response. This
    // is the recommended shape for real consumers (it also lets them branch on
    // `instanceof IdempotencyConflictError`). It can be omitted (see
    // `withErrorHandler`) to prove Express derives 409/417 natively.
    if (harnessOptions.withErrorHandler !== false) {
        app.use(
            (
                err: Error,
                _req: express.Request,
                res: express.Response,
                _next: express.NextFunction
            ) => {
                if (res.headersSent) {
                    return;
                }
                const typed = err as { statusCode?: number; status?: number };
                const fromError =
                    typeof typed.statusCode === 'number'
                        ? typed.statusCode
                        : typeof typed.status === 'number'
                          ? typed.status
                          : undefined;
                const code =
                    fromError ?? (res.statusCode >= 400 ? res.statusCode : 500);
                res.status(code).json({ error: err.message });
            }
        );
    }

    return { app, service, controls };
}
