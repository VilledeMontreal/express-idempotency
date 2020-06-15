// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { IdempotencyResource, IIdempotencyDataAdapter } from '../models/models';

/**
 * In memory data adapter is basically a map which store keys
 * and the associated resource.
 * Not great for production grade API. Should use a more adequate adapter.
 */
export class InMemoryDataAdapter implements IIdempotencyDataAdapter {
    // Resource storage
    private idempotencyResources: IdempotencyResource[] = [];

    public async findByIdempotencyKey(
        idempotencyKey: string
    ): Promise<IdempotencyResource> {
        const result = this.idempotencyResources.filter((value) => {
            return value.idempotencyKey === idempotencyKey;
        });

        if (result.length === 0) {
            return null;
        }

        return result[0];
    }

    public async create(
        idempotencyResource: IdempotencyResource
    ): Promise<void> {
        const resource = await this.findByIdempotencyKey(
            idempotencyResource.idempotencyKey
        );
        if (resource) {
            throw new Error('Duplicate');
        }
        this.idempotencyResources.push(idempotencyResource);
    }

    public async update(
        idempotencyResource: IdempotencyResource
    ): Promise<void> {
        const findIndex = this.idempotencyResources.findIndex(
            (x) => x.idempotencyKey === idempotencyResource.idempotencyKey
        );
        this.idempotencyResources[findIndex] = idempotencyResource;
    }

    public async delete(idempotencyKey: string): Promise<void> {
        const findIndex = this.idempotencyResources.findIndex(
            (x) => x.idempotencyKey === idempotencyKey
        );
        if (findIndex >= 0) {
            this.idempotencyResources.splice(findIndex, 1);
        }
    }
}
