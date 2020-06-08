TODO : Badges

([Français](#french-version))

<a id='english-version' class='anchor' aria-hidden='true'></a>

# Idempotency middleware for Express

Integrate idempotency feature to [Express](https://expressjs.com) routes quickly, without efforts. The implementation is inspired from the Stripe idempotency implementation.

This is a [Node.js](https://nodejs.org/) module designed to work with Express, available through the [NPM registry](https://www.npmjs.com/).

## Features

- Middleware for Express with a high level of customization
- Helpers to detect processing from the middleware and report errors

## Examples

For examples, check the `examples` folder.

## Getting started

Install the dependency.

```
$ npm install @villemontreal/idempotency-express
```

Integrate the middleware in your Express initialization.

```javascript
app.post('*', idempotency());
```

### Determine a idempotency hit in route handler

The idempotency middleware will call the next function, whenever a idempotency key is detected or not. This is by design to avoid breaking the middleware and route handler chain. To prevent transaction processing to occurs, there is a _hit_ function which determine if the idempotency middleware did process the request.

```javascript
app.post('/', function (req, res) {
  // Check if there was a hit!
  const idempotencyService = getSharedIdempotencyService();
  if (idempotencyService.isHit(req)) {
    return;
  }

  // Do something
  res.send('Got a new POST request');
});
```

### Report error in processing request

Sometimes, there is errors that can occur in the process of the request. In that case, the middleware must be aware of the error and remove any information related to the idempotency key that failed. You can notify the middleware by using the _reportError_ function.

```javascript
app.post('/', function (req, res) {
  const idempotencyService = getSharedIdempotencyService();

  // Processing...
  // Oh BOOM! There is a error. Let's notify the middleware.
  idempotencyService.reportError(req);
});
```

### Options

You can configure the way the idempotency middleware will behave by providing options during initialization.

```javascript
app.post(
  '*',
  idempotency({
    // Specify the header to be used to retrieve the idempotency key.
    idempotencyKeyHeader,
    // The data adapter used to store the resources.
    dataAdapter,
    // Logic to indicate if response must be kept for idempotency
    responseValidator,
    // Logic to detect misuse of the idempotency key
    intentValidator,
  })
);
```

#### Change the idempotency key header

By default, the header used to retrieve the idempotency key is `Idempotency-Key` but you can change it for any value you would like.

#### Data adapter

The data adapter allows to persist cached response for a idempotency key. The default implementation use in-memory storage, which is not recommended for production environment.

You can create your own data adapter by implementing the `IIdempotencyDataAdapter` interface but there is already some implementation ready.

- Mongo Data Adapter

Please feel free to email us to add your own implementation in this list.

#### Response validator

By default, a request will be considered successful and the response will be cached if the response http status code is between 200 and 299. If it is not the behavior that is wished, you can implement your own logic by providing your own responseValidator, which must implements the `IIdempotencyResponseValidator` interface.

```typescript
export class CustomResponseValidator implements IIdempotencyResponseValidator {
  public isValidForPersistence(idempotencyResponse: IdempotencyResponse): boolean {
    // Insert logic here
    // For example, we could cache any 500 status code.
    return idempotencyResponse.statusCode == 500;
  }
}
```

#### Intent validator

When receiving a request with an idempotency key, the middleware will compare it to the original request to ensure the intend. By default, the middleware is expecting a match for the **url**, the **method**, the **query parameters** and the **body**. If any of these element does not match, it will be qualified as a misuse of the idempotency key and an error will be thrown.

This intent validator can be override by providing your own implementation, if this is not the desired behavior. Simply implements the `IIdempotencyIntentValidator`interface.

```typescript
export class CustomIntentValidator implements IIdempotencyIntentValidator {

  isValidIntent(req: express.Request, idempotencyRequest: IdempotencyRequest): boolean {
    // Insert logic here
    // For example, the url must match
    return req.url === idempotencyRequest.url;
  }
```

## License

The source code of this project is distributed under the [MIT License](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md#english-version).

## Code of Conduct

Participation in this poject is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## References

1. [Designing robust and predictable APIs with idempotency](https://stripe.com/fr-ca/blog/idempotency)

---

([English](#english-version))

<a id='french-version' class='anchor' aria-hidden='true'></a>

# Gabarit pour dépôts de code source libre de la Ville de Montréal

## Gabarit pour README.md

Description du projet

### Détails

- Comment fonctionne le produit?
- À qui s'adresse le produit?

### Bâtir

### Installer

### Tester

### Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md#french-version)

### Licence et propriété intellectuelle

Le code source de ce projet est libéré sous la licence [MIT License](LICENSE).

### Code de Conduite

La participation à ce projet est réglementée part le [Code de Conduite](CODE_OF_CONDUCT.md#french-version)
