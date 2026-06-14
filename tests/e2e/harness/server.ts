// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import express = require('express');
import { Server } from 'http';
import { AddressInfo } from 'net';
import { buildApp } from './buildApp';
import { req, E2ERequestOptions, E2EResponse } from './client';

export interface RunningServer {
    server: Server;
    baseUrl: string;
    /**
     * Issue a request against this server and track it as in-flight, so close()
     * can drain it. Prefer this over the bare `req` helper in tests: a request
     * left un-awaited (e.g. when an assertion fails before its release) is still
     * drained on teardown instead of outliving the server.
     */
    request(options: E2ERequestOptions): Promise<E2EResponse>;
    close(): Promise<void>;
}

/**
 * Start an Express app on an ephemeral port (0) so multiple servers can run in
 * parallel without port collisions. Resolves with the bound base URL.
 */
export function startServer(app: express.Express): Promise<RunningServer> {
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const { port } = server.address() as AddressInfo;
            const baseUrl = `http://127.0.0.1:${port}`;
            const inflight = new Set<Promise<unknown>>();
            resolve({
                server,
                baseUrl,
                request(options: E2ERequestOptions): Promise<E2EResponse> {
                    const p = req(baseUrl, options);
                    inflight.add(p);
                    // Settle handlers (both branches) so an un-awaited request
                    // never surfaces as an unhandled rejection, and untrack it
                    // once done. The test still awaits `p` directly when needed.
                    p.then(
                        () => inflight.delete(p),
                        () => inflight.delete(p)
                    );
                    return p;
                },
                close: () =>
                    new Promise<void>((done) => {
                        // Drain in-flight requests first (handlers are released
                        // in afterEach), so no handler outlives the socket and
                        // writes to a closed connection.
                        Promise.allSettled([...inflight]).then(() => {
                            server.close(() => done());
                            // Force-close keep-alive sockets: the native fetch
                            // (undici) pools connections by host:port, and the
                            // OS often recycles this ephemeral port for the next
                            // test server. Without this, undici could reuse a
                            // dead socket pointing at the closed server. Closing
                            // them here lets undici evict them before reuse.
                            // (Node >= 18.2; harmless no-op guard on 18.0/18.1.)
                            if (
                                typeof server.closeAllConnections === 'function'
                            ) {
                                server.closeAllConnections();
                            }
                        });
                    }),
            });
        });
    });
}

// Standalone mode (`npm run e2e:serve`): exposes the harness for manual probing
// (curl / REST client), demonstrating the middleware over a real HTTP server.
if (require.main === module) {
    const port = Number(process.env.PORT) || 8080;
    const { app } = buildApp({ processingTimeout: 2000 });
    app.listen(port, () => {
        console.log(
            `express-idempotency e2e harness listening on http://localhost:${port}`
        );
    });
}
