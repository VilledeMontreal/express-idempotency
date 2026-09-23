// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

// Well below V8's call-stack limit; real request payloads stay under ~50.
const MAX_DEPTH = 1000;

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
    return (
        a.byteLength === b.byteLength &&
        Buffer.compare(
            new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
            new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
        ) === 0
    );
}

/**
 * One comparison run. Tracks the pairs currently under comparison up the call
 * chain so cyclic structures terminate.
 */
class LooseDeepComparer {
    private readonly ancestors = new Map<object, Set<object>>();

    // Type dispatch is inherently branchy; each branch is a one-liner.
    // eslint-disable-next-line complexity
    public equals(a: unknown, b: unknown, depth: number): boolean {
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
            // eslint-disable-next-line eqeqeq
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

        return this.equalObjects(a, b, depth);
    }

    /**
     * Own enumerable string keys only — no prototype walk, no symbol keys — so
     * a null-prototype object equals its plain-object twin.
     */
    private equalObjects(
        a: Record<string, unknown>,
        b: Record<string, unknown>,
        depth: number
    ): boolean {
        if (this.isAncestorPair(a, b)) {
            return true; // cycle: this pair is already being compared higher up
        }

        const aEntries = Object.entries(a);
        const bEntries = new Map(Object.entries(b));
        if (aEntries.length !== bEntries.size) {
            return false;
        }

        this.enter(a, b);
        try {
            return this.equalEntries(aEntries, bEntries, depth);
        } finally {
            this.leave(a, b);
        }
    }

    private equalEntries(
        aEntries: Array<[string, unknown]>,
        bEntries: Map<string, unknown>,
        depth: number
    ): boolean {
        for (const [key, aValue] of aEntries) {
            if (
                !bEntries.has(key) ||
                !this.equals(aValue, bEntries.get(key), depth + 1)
            ) {
                return false;
            }
        }
        return true;
    }

    private isAncestorPair(a: object, b: object): boolean {
        return this.ancestors.get(a)?.has(b) ?? false;
    }

    private enter(a: object, b: object): void {
        let seenWithA = this.ancestors.get(a);
        if (!seenWithA) {
            seenWithA = new Set();
            this.ancestors.set(a, seenWithA);
        }
        seenWithA.add(b);
    }

    private leave(a: object, b: object): void {
        const seenWithA = this.ancestors.get(a);
        seenWithA.delete(b);
        if (seenWithA.size === 0) {
            this.ancestors.delete(a);
        }
    }
}

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
    return new LooseDeepComparer().equals(a, b, 0);
}
