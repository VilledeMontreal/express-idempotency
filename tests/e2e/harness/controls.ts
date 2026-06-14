// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

/**
 * Deferred promise: an externally-resolvable promise used as a "gate" so a test
 * can hold a request handler in-progress and release it deterministically.
 */
interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}

function createDeferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

/**
 * Test controls shared between the harness server and a test case:
 * - gates: hold handlers in-progress until the test releases them;
 * - counters: count real handler executions (proof of hit vs takeover);
 * - deleted: track keys removed through the data adapter (cleanup assertions).
 */
export interface Controls {
    /** Await inside a handler; resolves when the test calls release(key). */
    gate(key: string): Promise<void>;
    /** Release a specific gate. */
    release(key: string): void;
    /** Release every pending gate (use in afterEach to avoid hanging). */
    releaseAll(): void;
    /** Increment and return the execution counter for a route. */
    bump(route: string): number;
    /** Read the execution counter for a route. */
    count(route: string): number;
    /** Record that a key was deleted through the data adapter. */
    recordDelete(key: string): void;
    /** Indicate whether a key was deleted through the data adapter. */
    wasDeleted(key: string): boolean;
}

export function makeControls(): Controls {
    const gates = new Map<string, Deferred>();
    const counters = new Map<string, number>();
    const deleted = new Set<string>();

    function gateFor(key: string): Deferred {
        let d = gates.get(key);
        if (!d) {
            d = createDeferred();
            gates.set(key, d);
        }
        return d;
    }

    return {
        gate(key: string): Promise<void> {
            return gateFor(key).promise;
        },
        release(key: string): void {
            gateFor(key).resolve();
        },
        releaseAll(): void {
            for (const d of gates.values()) {
                d.resolve();
            }
        },
        bump(route: string): number {
            const n = (counters.get(route) ?? 0) + 1;
            counters.set(route, n);
            return n;
        },
        count(route: string): number {
            return counters.get(route) ?? 0;
        },
        recordDelete(key: string): void {
            deleted.add(key);
        },
        wasDeleted(key: string): boolean {
            return deleted.has(key);
        },
    };
}
