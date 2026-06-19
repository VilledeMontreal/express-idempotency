Add idempotency to your express route, effortlessly, the way you want it.

#### Production (master)

[![CI](https://github.com/VilledeMontreal/express-idempotency/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/VilledeMontreal/express-idempotency/actions/workflows/ci.yml) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/958bd19185f44fcda617a15fb6a72c1d?branch=master)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Grade&branch=master)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/958bd19185f44fcda617a15fb6a72c1d?branch=master)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Coverage&branch=master)

#### Development branch (develop)

[![CI](https://github.com/VilledeMontreal/express-idempotency/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/VilledeMontreal/express-idempotency/actions/workflows/ci.yml) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/958bd19185f44fcda617a15fb6a72c1d?branch=develop)](https://www.codacy.com/gh/VilledeMontreal/express-idempotency?utm_source=github.com&utm_medium=referral&utm_content=VilledeMontreal/express-idempotency&utm_campaign=Badge_Grade&branch=develop)
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

### Requirements

- **Node.js** >= 18.0.0
- **TypeScript** >= 5.0.0 (if using TypeScript)
- **npm** >= 9.0.0

### Installation

Install the dependency.

```bash
npm install express-idempotency
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
        // Maximum processing time (ms) before an in-progress resource is
        // considered orphaned and can be taken over by a retry.
        // Disabled when absent or <= 0.
        processingTimeout,
    })
);
```

#### Change the idempotency key header

By default, the header used to retrieve the idempotency key is `Idempotency-Key` but you can change it for any value you would like.

#### Data adapter

The data adapter allows to persist cached response for a idempotency key. The default implementation use in-memory storage, which is not recommended for production environment.

You can create your own data adapter by implementing the `IIdempotencyDataAdapter` interface but there is already some implementation ready.

-   [Mongo Data Adapter](https://www.npmjs.com/package/express-idempotency-mongo-adapter)

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

#### Processing timeout

By default, if a request starts processing but never completes (crash, OOM, rollout, or a response sent via `res.end()` / streaming / `sendFile` that bypasses `res.send`), the in-progress resource remains locked and subsequent retries receive a permanent `409 Conflict` until the adapter's TTL expires.

The `processingTimeout` option (in milliseconds) enables a lease mechanism: if a retry arrives after the timeout has elapsed since the resource was created, the middleware considers the original request orphaned and takes over processing.

```javascript
app.post(
    '*',
    idempotency({
        dataAdapter,
        // Allow a retry to take over after 30 seconds
        processingTimeout: 30_000,
    })
);
```

**Requirements and caveats:**

- The data adapter must persist and return the `createdAt` field of `IdempotencyResource`. Without it the feature is silently inert (safe degradation to the v2.0.0 behaviour).
- Choose a value at least 2× the worst-case processing duration to avoid false takeovers.
- Due to the check-then-act nature of the takeover, at-least-once delivery semantics apply when the timeout is reached. If two retries race at expiry, one will win and the other will fall back to a `409`.
- When a response is sent via `res.end()`, streaming, or `sendFile` (bypassing `res.send`), the middleware cannot capture the body. It automatically deletes the resource so the next retry is reprocessed rather than permanently blocked.

## Testing

This library has two test layers, both run in CI on every branch:

- **Unit tests** — `npm test` (mock-based, fast; coverage reported to Codacy via lcov).
- **End-to-end tests** — `npm run test:e2e` exercises the full middleware over a **real HTTP server** (Express + native `fetch`): replay/hit, `409` in-progress conflict, concurrent retries, `processingTimeout` takeover, zombie-write guard, phantom-key cleanup (`res.end` bypass), intent mismatch (`417`) and `reportError`.

`npm run test:all` runs both layers. The e2e suite requires **Node >= 18.2** (it relies on `server.closeAllConnections`).

### Manual probing

A standalone harness server is available for manual exploration with curl or a REST client:

```bash
npm run e2e:serve   # http://localhost:8080 (override with the PORT env var)

# Same key replays the first response; a different key is processed fresh:
curl -H 'Idempotency-Key: demo-1' http://localhost:8080/resource
curl -H 'Idempotency-Key: demo-1' http://localhost:8080/resource
```

> **Error handling:** the middleware signals conflicts and misuse by calling `next(err)` with a typed error — `IdempotencyConflictError` (`409`) or `IdempotencyIntentMismatchError` (`417`). Both extend the exported `IdempotencyError` and carry the HTTP status on `statusCode` (and `status`), so Express derives the correct code natively — no custom error handler required. Registering one is still recommended to shape the response body; it can branch on the error type with `instanceof` or read `err.statusCode`. See `tests/e2e/harness/buildApp.ts` for a reference handler.

### Reusing the suite for custom adapters

The behavioural suite is factored as `runIdempotencySuite(makeApp)` (`tests/e2e/harness/scenarios.ts`), so a custom data adapter can replay the exact same guarantees:

```typescript
import { buildApp } from './harness/buildApp';
import { runIdempotencySuite } from './harness/scenarios';

describe('MyAdapter over real HTTP', () => {
    runIdempotencySuite((options) => buildApp({ ...options, dataAdapter: new MyAdapter() }));
});
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
        // Durée maximale de traitement (ms) avant qu'une ressource en cours soit
        // considérée orpheline et reprise par une nouvelle tentative.
        // Désactivé si absent ou <= 0.
        processingTimeout,
    })
);
```

#### Changer la clé d'entête de requête

Par défaut, l'entête utilisé pour la clé d'idempotence est `Idempotency-Key` mais elle peut être changé pour une autre valeur désirée.

#### Adapteur de données

L'adapteur de données permet de persister l'information relatif à la clé d'idempotence. L'implémentation par défaut conserve l'information en mémoire, ce qui n'est pas recommandé pour un environnement de production.

Vous pouvez créer votre propre adapteur de données par l'implémentation de l'interface `IIdempotencyDataAdapter`. Les implémentations connues sont les suivantes :

-   [Mongo Data Adapter](https://www.npmjs.com/package/express-idempotency-mongo-adapter)

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

#### Délai de traitement

Par défaut, si une requête démarre son traitement mais ne se termine jamais (crash, OOM, redéploiement, ou réponse envoyée via `res.end()` / streaming / `sendFile` sans passer par `res.send`), la ressource en cours reste verrouillée et les nouvelles tentatives reçoivent un `409 Conflict` permanent jusqu'à l'expiration du TTL de l'adapteur.

L'option `processingTimeout` (en millisecondes) active un mécanisme de bail : si une nouvelle tentative arrive après l'écoulement du délai depuis la création de la ressource, le middleware considère la requête originale comme orpheline et reprend le traitement.

```javascript
app.post(
    '*',
    idempotency({
        dataAdapter,
        // Permettre à une nouvelle tentative de reprendre après 30 secondes
        processingTimeout: 30_000,
    })
);
```

**Prérequis et mises en garde :**

- L'adapteur de données doit persister et retourner le champ `createdAt` de `IdempotencyResource`. Sans cela, la fonctionnalité est silencieusement inerte (dégradation propre vers le comportement v2.0.0).
- Choisir une valeur d'au moins 2× la durée de traitement maximale pour éviter les reprises prématurées.
- En raison de la nature « vérifier puis agir » de la reprise, une sémantique de livraison « au moins une fois » s'applique lorsque le délai est atteint. Si deux tentatives entrent en concurrence à l'expiration, l'une gagnera et l'autre recevra un `409`.
- Lorsqu'une réponse est envoyée via `res.end()`, le streaming ou `sendFile` (sans passer par `res.send`), le middleware ne peut pas capturer le corps. Il supprime automatiquement la ressource afin que la prochaine tentative soit retraitée plutôt que bloquée de façon permanente.

## Tests

La librairie comporte deux niveaux de tests, tous deux exécutés en CI sur chaque branche :

- **Tests unitaires** — `npm test` (basés sur des mocks, rapides ; couverture envoyée à Codacy via lcov).
- **Tests de bout en bout** — `npm run test:e2e` exerce l'ensemble du middleware sur un **vrai serveur HTTP** (Express + `fetch` natif) : rejeu/hit, conflit `409` en cours de traitement, tentatives concurrentes, reprise par `processingTimeout`, garde anti-écriture « zombie », nettoyage des clés fantômes (contournement de `res.send` via `res.end()`), intention divergente (`417`) et `reportError`.

`npm run test:all` lance les deux niveaux. La suite e2e requiert **Node >= 18.2** (elle s'appuie sur `server.closeAllConnections`).

### Exploration manuelle

Un serveur de test autonome permet une exploration manuelle (curl ou client REST) :

```bash
npm run e2e:serve   # http://localhost:8080 (modifiable via la variable d'env PORT)

# Une même clé rejoue la première réponse ; une clé différente est traitée à neuf :
curl -H 'Idempotency-Key: demo-1' http://localhost:8080/resource
curl -H 'Idempotency-Key: demo-1' http://localhost:8080/resource
```

> **Gestion des erreurs :** le middleware signale les conflits et les mésusages en appelant `next(err)` avec une erreur typée — `IdempotencyConflictError` (`409`) ou `IdempotencyIntentMismatchError` (`417`). Toutes deux héritent de l'erreur exportée `IdempotencyError` et portent le statut HTTP sur `statusCode` (et `status`), de sorte qu'Express en dérive nativement le bon code — aucun gestionnaire d'erreurs personnalisé n'est requis. En enregistrer un reste recommandé pour mettre en forme le corps de la réponse ; il peut discriminer le type d'erreur avec `instanceof` ou lire `err.statusCode`. Voir `tests/e2e/harness/buildApp.ts` pour un gestionnaire de référence.

### Réutiliser la suite pour des adapteurs personnalisés

La suite comportementale est factorisée sous la forme `runIdempotencySuite(makeApp)` (`tests/e2e/harness/scenarios.ts`), de sorte qu'un adapteur de données personnalisé peut rejouer exactement les mêmes garanties :

```typescript
import { buildApp } from './harness/buildApp';
import { runIdempotencySuite } from './harness/scenarios';

describe('MonAdapteur sur un vrai serveur HTTP', () => {
    runIdempotencySuite((options) => buildApp({ ...options, dataAdapter: new MonAdapteur() }));
});
```

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md#french-version)

## Licence et propriété intellectuelle

Le code source de ce projet est libéré sous la licence [MIT License](LICENSE).

## Code de Conduite

La participation à ce projet est réglementée part le [Code de Conduite](CODE_OF_CONDUCT.md#french-version)

## Références

1. [Designing robust and predictable APIs with idempotency](https://stripe.com/fr-ca/blog/idempotency)
