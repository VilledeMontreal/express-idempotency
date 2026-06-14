// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { buildApp } from './harness/buildApp';
import { runIdempotencySuite } from './harness/scenarios';

describe('InMemoryDataAdapter (default) over real HTTP', () => {
    runIdempotencySuite((options) => buildApp(options));
});
