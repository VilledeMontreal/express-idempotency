// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

const express = require('express');
const app = express();
const idempotency = require('express-idempotency');

app.use(idempotency.idempotency());

app.all('/', function (req, res) {
    const idempotencyService = idempotency.getSharedIdempotencyService();
    if (idempotencyService.isHit(req)) {
        console.log('Idempotency middleware did already process the request!');
        return;
    }

    // Return the current date and time
    res.send(new Date().toISOString());
});

app.listen(8080, function () {
    console.log(
        'Example app listening on port 8080 with express-idempotency middleware.'
    );
});
