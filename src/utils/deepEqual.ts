// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

/**
 * Prototype-agnostic, loose deep equality for JSON-like data.
 *
 * Zero-dependency replacement for `deep-equal` (loose mode). Prototypes are
 * never compared: Express 5 builds a null-prototype `req.query`, while a
 * serialising data adapter returns plain objects, and both must match
 * (`util.isDeepStrictEqual` would reject them and turn every retry into a 417).
 * Primitives are compared with `==` to keep the previous loose semantics.
 *
 * Handles primitives, arrays, objects of any prototype (own enumerable string
 * keys), `Date` (by timestamp), binary views (by bytes) and cycles. Out of
 * scope (never produced by a body/query parser): `RegExp`, `Map`, `Set`… which
 * fall back to own-key comparison. Inputs are client-controlled: nesting
 * deeper than `MAX_DEPTH` fails closed (`false`).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
    return equals(a, b, new Map(), 0);
}

// Well below V8's call-stack limit; real request payloads stay under ~50.
const MAX_DEPTH = 1000;

// Pairs currently under comparison up the call chain (cycle detection).
type Ancestors = Map<object, Set<object>>;

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function equals(
    a: unknown,
    b: unknown,
    ancestors: Ancestors,
    depth: number
): boolean {
    if (a === b) {
        return true;
    }
    if (depth > MAX_DEPTH) {
        return false;
    }

    const aIsObject = isObjectLike(a);
    const bIsObject = isObjectLike(b);
    if (!aIsObject || !bIsObject) {
        // Only two primitives can be loosely equal; an object never equals one.
        return !aIsObject && !bIsObject && a == b;
    }

    const aIsDate = a instanceof Date;
    const bIsDate = b instanceof Date;
    if (aIsDate || bIsDate) {
        return aIsDate && bIsDate && a.getTime() === b.getTime();
    }

    if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
    }

    const aIsView = ArrayBuffer.isView(a);
    const bIsView = ArrayBuffer.isView(b);
    if (aIsView || bIsView) {
        return aIsView && bIsView && sameBytes(a, b);
    }

    // Pair already under comparison higher up the call chain: a cycle.
    let seenWithA = ancestors.get(a);
    if (seenWithA?.has(b)) {
        return true;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }

    if (!seenWithA) {
        seenWithA = new Set();
        ancestors.set(a, seenWithA);
    }
    seenWithA.add(b);
    try {
        for (const key of aKeys) {
            // `hasOwnProperty.call`: a null-prototype object has no such method.
            if (
                !Object.prototype.hasOwnProperty.call(b, key) ||
                !equals(a[key], b[key], ancestors, depth + 1)
            ) {
                return false;
            }
        }
        return true;
    } finally {
        seenWithA.delete(b);
        if (seenWithA.size === 0) {
            ancestors.delete(a);
        }
    }
}

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
    if (a.byteLength !== b.byteLength) {
        return false;
    }
    const aBytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bBytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < aBytes.length; i++) {
        if (aBytes[i] !== bBytes[i]) {
            return false;
        }
    }
    return true;
}
