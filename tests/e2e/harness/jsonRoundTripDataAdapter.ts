// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import {
    IdempotencyResource,
    IIdempotencyDataAdapter,
} from '../../../src/models/models';

/**
 * In-memory data adapter that serialises every resource to JSON at rest and
 * parses it back on read, the way a real persistence layer (Mongo, Redis, SQL)
 * behaves. Unlike `InMemoryDataAdapter`, nothing is stored by reference:
 * `createdAt` comes back as an ISO string, `undefined` fields disappear, and
 * `request.query` / `request.body` come back as plain `Object.prototype`
 * objects — never the null-prototype object Express 5 builds for `req.query`.
 */
export class JsonRoundTripDataAdapter implements IIdempotencyDataAdapter {
    private readonly store = new Map<string, string>();

    public async findByIdempotencyKey(
        idempotencyKey: string
    ): Promise<IdempotencyResource | null> {
        const raw = this.store.get(idempotencyKey);
        return raw === undefined ? null : JSON.parse(raw);
    }

    public async create(resource: IdempotencyResource): Promise<void> {
        if (this.store.has(resource.idempotencyKey)) {
            throw new Error('Duplicate');
        }
        this.store.set(resource.idempotencyKey, JSON.stringify(resource));
    }

    public async update(resource: IdempotencyResource): Promise<void> {
        if (!this.store.has(resource.idempotencyKey)) {
            return;
        }
        this.store.set(resource.idempotencyKey, JSON.stringify(resource));
    }

    public async delete(idempotencyKey: string): Promise<void> {
        this.store.delete(idempotencyKey);
    }
}
