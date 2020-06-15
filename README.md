Add idempotency to your express route, effortlessly, the way you want it.

#### Production (master)

[![CircleCI](https://circleci.com/gh/VilledeMontreal/express-idempotency/tree/master.svg?style=shield)](https://circleci.com/gh/VilledeMontreal/express-idempotency/tree/master) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/958bd19185f44fcda617a15fb6a72c1d?branch=master)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Grade&branch=master)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/958bd19185f44fcda617a15fb6a72c1d?branch=master)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Coverage&branch=master)

#### Development branch (develop)

[![CircleCI](https://circleci.com/gh/VilledeMontreal/express-idempotency/tree/develop.svg?style=shield)](https://circleci.com/gh/VilledeMontreal/express-idempotency/tree/develop) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/958bd19185f44fcda617a15fb6a72c1d?branch=develop)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Grade&branch=develop)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/958bd19185f44fcda617a15fb6a72c1d?branch=develop)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Coverage&branch=develop)

([Français](#french-version))

<a id='english-version' class='anchor' aria-hidden='true'></a>

# Idempotency middleware for Express

Integrate idempotency feature to [Express](https://expressjs.com) routes quickly, without efforts. The implementation is inspired from the Stripe idempotency implementation.

This is a [Node.js](https://nodejs.org/) module designed to work with Express, available through the [NPM registry](https://www.npmjs.com/).

## Features

-   Middleware for Express with a high level of customization
-   Helpers to detect processing from the middleware and report errors

## Examples

For examples, check the `examples` folder.

## Getting started

Install the dependency.

```
$ npm install express-idempotency
```

Integrate the middleware in your Express initialization.

```javascript
// Javascript
const idempotency = require('express-idempotency');
// ...express initialization
app.post('*', idempotency.idempotency());

// Typescript
import { idempotency } from 'express-idempotency';
// ...express initialization
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

-   Mongo Data Adapter

#### Response validator

By default, a request will be considered successful and the response will be cached if the response http status code is between 200 and 299. If it is not the behavior that is wished, you can implement your own logic by providing your own responseValidator, which must implements the `IIdempotencyResponseValidator` interface.

```typescript
export class CustomResponseValidator implements IIdempotencyResponseValidator {
    public isValidForPersistence(
        idempotencyResponse: IdempotencyResponse
    ): boolean {
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

# Middleware d'idempotence pour Express

Ajouter à [Express](https://expressjs.com) des fonctionnalités d'idempotence pour certaines routes rapidement, sans effort. L'implémentation est inspirée par la stratégie de Stripe.

Ce module [Node.js](https://nodejs.org/) est conçu pour fonctionner avec Express, et disponible sur le [registre NPM](https://www.npmjs.com/).

## Fonctionnalités

-   Middleware pour Express avec un haut niveau de configuration
-   Utilitaires pour permettre la détection de l'intervention du middleware et rapporter les erreurs

## Exemples

Pour des exemples, voir le répertoire `examples`.

## Démarrage rapide

Installation de la dépendance.

```
$ npm install express-idempotency
```

Intégrer le middleware dans l'initialisation de votre application Express.

```javascript
// Javascript
const idempotency = require('express-idempotency');
// ...initialisation de Express
app.post('*', idempotency.idempotency());

// Typescript
import { idempotency } from 'express-idempotency';
// ...initialisation de Express
app.post('*', idempotency());
```

### Déterminer l'intervention du middleware dans une route

Le middleware d'idempotence va faire l'appel de la fonction next, peu importe si la clé d'idempotence est détecté ou non. Cette décision de design permet de conserver la chaine de communication quant à la prise en charge de la requête. Afin de prévenir une transaction d'être exécuté une deuxième fois, il y a une fonction _hit_ permettant d'identifier le traitement préalable du middleware.

```javascript
app.post('/', function (req, res) {
    // Vérifier l'intenvention!
    const idempotencyService = getSharedIdempotencyService();
    if (idempotencyService.isHit(req)) {
        return;
    }

    // Faire quelque chose
    res.send('Got a new POST request');
});
```

### Rapporter des erreurs de traitement

Quelques fois, on veut communiquer au middleware que le traitement attendu a échoué. Dans ces cas, il faut que le middleware sache qu'une erreur est survenue et retirer l'information relative à la clé d'idempotence courante. On peut donc notifier le middleware en utilisant la fonction _reportError_.

```javascript
app.post('/', function (req, res) {
    const idempotencyService = getSharedIdempotencyService();

    // Processing...
    // Oh BOOM! There is a error. Let's notify the middleware.
    idempotencyService.reportError(req);
});
```

### Options

Vous pouvez configurer lors de l'initialisation la façon dont le middleware va se comporter.

```javascript
app.post(
    '*',
    idempotency({
        // Préciser l'entête de requête contenant la clé d'idempotence.
        idempotencyKeyHeader,
        // L'adapteur de données utilisé pour stocker les informations.
        dataAdapter,
        // Préciser la logique permettant d'indiquer si la réponse doit être conservé pour l'idempotence.
        responseValidator,
        // Préciser la logique à appliquer pour s'assurer de la bonne utilisation de la clé d'idempotence.
        intentValidator,
    })
);
```

#### Changer la clé d'entête de requête

Par défaut, l'entête utilisé pour la clé d'idempotence est `Idempotency-Key` mais elle peut être changé pour une autre valeur désirée.

#### Adapteur de données

L'adapteur de données permet de persister l'information relatif à la clé d'idempotence. L'implémentation par défaut conserve l'information en mémoire, ce qui n'est pas recommandé pour un environnement de production.

Vous pouvez créer votre propre adapteur de données par l'implémentation de l'interface `IIdempotencyDataAdapter`. Les implémentations connues sont les suivantes :

-   Mongo Data Adapter

#### Validateur de réponse

Par défaut, une requête est considéré valide lorsque le statut http est entre 200 et 299 inclusivement. À ce moment-là, la réponse est persistée. Si ce n'est pas le comportement attendu, il est possible d'implémenter sa propre logique en fournissant votre propre validateur de réponse. À ce moment-là, il faut implémenter l'interface `IIdempotencyResponseValidator`.

```typescript
export class CustomResponseValidator implements IIdempotencyResponseValidator {
    public isValidForPersistence(
        idempotencyResponse: IdempotencyResponse
    ): boolean {
        // Insert logic here
        // For example, we could cache any 500 status code.
        return idempotencyResponse.statusCode == 500;
    }
}
```

#### Validateur d'intention

Lorsqu'on reçoit une requête avec une clé d'idempotence, le middleware va comparer celle-ci avec la requête originale ayant généré une ressource idempotente afin d'assurer l'intention. Par défaut, le middleware va s'assurer que l'adresse (url), la méthode, les paramètres de requête et le contenu. Si l'un de ces éléments divergent, la requête va être considéré comme invalide et l'utilisation de la clé d'idempotence incorrecte.

Ce comporement peut être remplacé en fournissant son propre validateur d'intention par l'implémentation de l'interface `IIdempotencyIntentValidator`.

```typescript
export class CustomIntentValidator implements IIdempotencyIntentValidator {

  isValidIntent(req: express.Request, idempotencyRequest: IdempotencyRequest): boolean {
    // Insérer logique ici
    // Par exemple, seulement l'adresse doit correspondre
    return req.url === idempotencyRequest.url;
  }
```

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md#french-version)

## Licence et propriété intellectuelle

Le code source de ce projet est libéré sous la licence [MIT License](LICENSE).

## Code de Conduite

La participation à ce projet est réglementée part le [Code de Conduite](CODE_OF_CONDUCT.md#french-version)

## Références

1. [Designing robust and predictable APIs with idempotency](https://stripe.com/fr-ca/blog/idempotency)
