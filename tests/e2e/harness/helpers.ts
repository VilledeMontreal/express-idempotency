// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { faker } from '@faker-js/faker';

/**
 * Generate a unique idempotency key for a test case.
 */
export function genKey(): string {
    return faker.string.uuid();
}

/**
 * Resolve after the given delay (real time).
 */
export function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a predicate until it becomes true or the timeout elapses. Used to await
 * asynchronous side effects (resource creation, cleanup) without relying on
 * fixed sleeps — keeps the suite robust on slow CI machines.
 */
export async function waitUntil(
    predicate: () => boolean,
    timeoutMs = 2000,
    intervalMs = 10
): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitUntil: condition not met before timeout');
        }
        await wait(intervalMs);
    }
}

/**
 * Fire `count` invocations of `fn` concurrently and wait for all to settle.
 */
export function concurrent<T>(
    count: number,
    fn: (index: number) => Promise<T>
): Promise<PromiseSettledResult<T>[]> {
    return Promise.allSettled(
        Array.from({ length: count }, (_unused, i) => fn(i))
    );
}
