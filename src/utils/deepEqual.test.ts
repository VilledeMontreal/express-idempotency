import { assert } from 'chai';
import { deepEqual } from './deepEqual';

// Build a null-prototype object, as Express 5's default ('simple') query
// parser does for `req.query`.
function nullProto<T extends object>(source: T): T {
    return Object.assign(Object.create(null), source);
}

// Simulate a serialising data adapter (Mongo, Redis, SQL…): what comes back
// from storage is a plain `Object.prototype` object, never a null-prototype one.
function roundTrip<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

describe('deepEqual (prototype-agnostic, loose)', () => {
    describe('prototype agnosticism (regression for null-prototype req.query)', () => {
        it('treats an empty null-prototype object as equal to {}', () => {
            assert.isTrue(deepEqual(nullProto({}), {}));
            assert.isTrue(deepEqual({}, nullProto({})));
        });

        it('treats a null-prototype object as equal to its plain twin', () => {
            const query = nullProto({ param1: 'a', param2: 'b' });
            assert.isTrue(deepEqual(query, roundTrip(query)));
            assert.isTrue(deepEqual(roundTrip(query), query));
        });

        it('ignores prototypes on nested objects', () => {
            const a = { q: nullProto({ x: '1' }), b: [nullProto({ y: '2' })] };
            assert.isTrue(deepEqual(a, roundTrip(a)));
        });

        it('treats two null-prototype objects with the same keys as equal', () => {
            assert.isTrue(deepEqual(nullProto({ a: 1 }), nullProto({ a: 1 })));
        });

        it('compares a class instance with a plain object by own keys only', () => {
            class Payload {
                public a = 1;
            }
            assert.isTrue(deepEqual(new Payload(), { a: 1 }));
        });

        it('ignores symbol keys', () => {
            assert.isTrue(deepEqual({ a: 1, [Symbol('s')]: 2 }, { a: 1 }));
        });
    });

    describe('primitives (loose, mirrors deep-equal non-strict mode)', () => {
        it('compares identical primitives', () => {
            assert.isTrue(deepEqual('a', 'a'));
            assert.isTrue(deepEqual(1, 1));
            assert.isTrue(deepEqual(true, true));
            assert.isTrue(deepEqual(undefined, undefined));
            assert.isTrue(deepEqual(null, null));
        });

        it('compares primitives loosely (==)', () => {
            assert.isTrue(deepEqual(1, '1'));
            assert.isTrue(deepEqual('1000', 1e3));
            assert.isTrue(deepEqual(true, 1));
            assert.isTrue(deepEqual('1', true));
            assert.isTrue(deepEqual('', 0));
            assert.isTrue(deepEqual('', false));
            assert.isTrue(deepEqual(null, undefined));
            assert.isTrue(deepEqual(0, -0));
        });

        it('detects differing primitives', () => {
            assert.isFalse(deepEqual('a', 'b'));
            assert.isFalse(deepEqual('abc', 5));
            assert.isFalse(deepEqual('', undefined));
            assert.isFalse(deepEqual('', null));
            assert.isFalse(deepEqual(null, 0));
        });

        it('never equates NaN with NaN', () => {
            assert.isFalse(deepEqual(NaN, NaN));
        });

        it('never equates an object with a primitive', () => {
            assert.isFalse(deepEqual(null, {}));
            assert.isFalse(deepEqual(undefined, {}));
            assert.isFalse(deepEqual([], false));
            assert.isFalse(deepEqual('a', new String('a')));
            assert.isFalse(deepEqual(new Number(1), 1));
        });

        it('compares functions by reference', () => {
            assert.isTrue(deepEqual(Math.max, Math.max));
            assert.isFalse(deepEqual(Math.max, Math.min));
        });
    });

    describe('objects', () => {
        it('compares nested structures', () => {
            assert.isTrue(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] }));
            assert.isFalse(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 2 }] }));
        });

        it('is insensitive to key order', () => {
            assert.isTrue(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
        });

        it('detects extra or missing keys', () => {
            assert.isFalse(deepEqual({ a: 1 }, { a: 1, b: 2 }));
            assert.isFalse(deepEqual({ a: 1, b: 2 }, { a: 1 }));
        });

        it('does not equate an undefined-valued key with a missing key', () => {
            assert.isFalse(deepEqual({ a: undefined }, {}));
            assert.isFalse(deepEqual({ a: null }, {}));
            assert.isTrue(deepEqual({ a: null }, { a: undefined }));
        });

        it('compares deeply nested payloads within the depth limit', () => {
            const nest = (depth: number): unknown =>
                Array.from({ length: depth }).reduce(
                    (inner) => ({ a: inner }),
                    { leaf: 1 } as unknown
                );
            assert.isTrue(deepEqual(nest(500), nest(500)));
            assert.isFalse(deepEqual(nest(500), nest(501)));
        });

        it('fails closed (false) beyond the depth limit instead of overflowing the stack', () => {
            const nest = (depth: number): unknown =>
                Array.from({ length: depth }).reduce((inner) => [inner], {
                    leaf: 1,
                } as unknown);
            const deep = nest(50000);
            assert.isFalse(deepEqual(deep, nest(50000)));
            assert.isTrue(deepEqual(deep, deep)); // same reference short-circuits
        });

        it('tolerates cyclic references', () => {
            const a: any = { name: 'x' };
            a.self = a;
            const b: any = { name: 'x' };
            b.self = b;
            assert.isTrue(deepEqual(a, b));

            const c: any = { name: 'y' };
            c.self = c;
            assert.isFalse(deepEqual(a, c));
        });
    });

    describe('arrays', () => {
        it('compares arrays element-wise, in order', () => {
            assert.isTrue(deepEqual([1, 2], [1, 2]));
            assert.isFalse(deepEqual([1, 2], [2, 1]));
            assert.isFalse(deepEqual([1], [1, undefined]));
        });

        it('never equates an array with an array-like object', () => {
            assert.isFalse(deepEqual([1], { 0: 1 }));
            assert.isFalse(deepEqual({}, []));
            assert.isFalse(deepEqual(['a'], nullProto({ 0: 'a', length: 1 })));
        });

        it('distinguishes holes from explicit undefined', () => {
            // eslint-disable-next-line no-sparse-arrays
            assert.isFalse(deepEqual([, 1], [undefined, 1]));
            assert.isTrue(deepEqual([undefined], [null]));
        });
    });

    describe('dates', () => {
        it('compares dates by timestamp', () => {
            assert.isTrue(deepEqual(new Date(1000), new Date(1000)));
            assert.isFalse(deepEqual(new Date(1000), new Date(2000)));
        });

        it('never equates a date with its ISO string', () => {
            const d = new Date(1000);
            assert.isFalse(deepEqual(d, d.toISOString()));
            assert.isFalse(deepEqual({ d }, roundTrip({ d })));
        });
    });

    describe('binary payloads', () => {
        it('compares buffers by content', () => {
            assert.isTrue(deepEqual(Buffer.from('ab'), Buffer.from('ab')));
            assert.isFalse(deepEqual(Buffer.from('ab'), Buffer.from('ac')));
            assert.isFalse(deepEqual(Buffer.from('ab'), Buffer.from('abc')));
        });

        it('compares typed arrays by content', () => {
            assert.isTrue(
                deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))
            );
            assert.isFalse(
                deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))
            );
        });

        it('never equates a buffer with its JSON representation', () => {
            const buf = Buffer.from('ab');
            assert.isFalse(deepEqual(buf, roundTrip(buf)));
            assert.isFalse(deepEqual(buf, [97, 98]));
        });
    });
});
