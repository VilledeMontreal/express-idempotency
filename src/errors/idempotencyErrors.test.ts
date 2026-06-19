import { assert } from 'chai';
import * as HttpStatus from 'http-status-codes';
import {
    IdempotencyError,
    IdempotencyConflictError,
    IdempotencyIntentMismatchError,
} from './idempotencyErrors';

describe('Idempotency errors', () => {
    describe('IdempotencyConflictError', () => {
        it('is an Error and an IdempotencyError, carrying a 409 status', () => {
            const err = new IdempotencyConflictError();

            assert.instanceOf(err, Error);
            assert.instanceOf(err, IdempotencyError);
            assert.instanceOf(err, IdempotencyConflictError);
            assert.equal(err.statusCode, HttpStatus.CONFLICT);
            assert.equal(err.status, HttpStatus.CONFLICT);
            assert.equal(err.name, 'IdempotencyConflictError');
        });

        it('exposes a default message and accepts an override', () => {
            assert.equal(
                new IdempotencyConflictError().message,
                'A previous request is still in progress for this key.'
            );
            assert.equal(
                new IdempotencyConflictError('custom').message,
                'custom'
            );
        });
    });

    describe('IdempotencyIntentMismatchError', () => {
        it('is an Error and an IdempotencyError, carrying a 417 status', () => {
            const err = new IdempotencyIntentMismatchError();

            assert.instanceOf(err, Error);
            assert.instanceOf(err, IdempotencyError);
            assert.instanceOf(err, IdempotencyIntentMismatchError);
            assert.equal(err.statusCode, HttpStatus.EXPECTATION_FAILED);
            assert.equal(err.status, HttpStatus.EXPECTATION_FAILED);
            assert.equal(err.name, 'IdempotencyIntentMismatchError');
        });

        it('exposes a default message and accepts an override', () => {
            assert.equal(
                new IdempotencyIntentMismatchError().message,
                'Misuse of the idempotency key. Please check your request.'
            );
            assert.equal(
                new IdempotencyIntentMismatchError('custom').message,
                'custom'
            );
        });
    });

    it('the two concrete errors are distinguishable via instanceof', () => {
        const conflict: IdempotencyError = new IdempotencyConflictError();
        const mismatch: IdempotencyError = new IdempotencyIntentMismatchError();

        assert.isFalse(conflict instanceof IdempotencyIntentMismatchError);
        assert.isFalse(mismatch instanceof IdempotencyConflictError);
    });
});
