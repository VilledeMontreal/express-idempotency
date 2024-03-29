import {
    getSharedIdempotencyService,
    idempotency,
    ERROR_MSG_NOT_INITIALIZED,
} from './idempotency';
import { assert } from 'chai';

describe('Idempotency middleware', () => {
    it('returns an error if not initialized', () => {
        try {
            getSharedIdempotencyService();
            assert.fail(
                'Expecting error to be thrown because the middleware has not been called.'
            );
        } catch (err) {
            if (err instanceof Error) {
                assert.equal(err.message, ERROR_MSG_NOT_INITIALIZED);
                assert.ok(err);
            } else {
                assert.fail('Wrong error type');
            }
        }
    });

    it('returns valid function and instantiate idempotency service', () => {
        const middleware = idempotency();
        assert.isFunction(middleware);
        const service = getSharedIdempotencyService();
        assert.ok(service);
    });
});
