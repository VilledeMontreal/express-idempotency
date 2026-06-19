# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

Librairie npm open source (`express-idempotency`, MIT) : middleware Express qui rend des routes non-idempotentes (POST, PATCH…) idempotentes à la manière de Stripe. La première requête portant un header `Idempotency-Key` est traitée et sa réponse mise en cache ; les retries avec la même clé reçoivent la réponse cachée sans ré-exécuter le traitement.

**Attention** : ce repo n'est PAS un projet `generator-mtl-node-api`. Les conventions du CLAUDE.md parent `~/VDM/` (commandes `node run`, structure controllers/services/repositories, corelibs `@villedemontreal/*`) ne s'appliquent pas ici. Utiliser `npm run` directement.

## Commandes

| Commande | Usage |
|----------|-------|
| `npm test` | Typecheck des tests (`tsconfig.test.json` → `.temp/`, artéfact généré) puis `nyc mocha` sur `src/**/*.test.ts` via ts-node |
| `npx mocha src/services/idempotencyService.test.ts` | Un seul fichier de test (`.mocharc.yml` fournit ts-node/register) |
| `npx mocha --grep "pattern"` | Tests filtrés par nom de cas |
| `npm run compile` | Build de distribution → `dist/` (`tsconfig.dist.json`, CommonJS, ES2020, `.d.ts` émis) |
| `npm run lint` / `npm run lint:fix` | ESLint 9 (flat config `eslint.config.js`) |
| `npm run prettier` / `npm run prettier:fix` | Prettier en mode check / write |
| `npm run test:e2e` | Suite e2e sur vrai serveur HTTP (`.mocharc.e2e.yml` + `tsconfig.e2e.json`, specs `tests/e2e/**/*.e2e.test.ts`) |
| `npm run test:all` | `npm test` (unitaire) puis `npm run test:e2e` |
| `npm run e2e:serve` | Démarre le harness en standalone (port 8080, override `PORT`) pour debug manuel (curl/REST) |

Hooks Husky : `pre-commit` est vide par design ; `pre-push` exécute `npm run prettier && npm run lint && npm test` — tout doit passer avant un push. `commit-msg` impose Conventional Commits (commitlint).

**Piège** : le typecheck de `npm test` est incrémental (`tsc --build` + `.temp/*.tsbuildinfo`) — après un changement de dépendances, valider avec `./node_modules/.bin/tsc --build tsconfig.test.json --force` pour reproduire le typecheck à froid de la CI (un `npm test` local peut passer alors que la CI casse).

## Release

CircleCI publie sur npm uniquement sur tag git : `vX.Y.Z` → publication normale, `vX.Y.Z-<suffixe>` → publication avec dist-tag `rc`. Les tests tournent sur toutes les branches ; la couverture (lcov) part vers Codacy. Branches : `master` (production) et `develop`.

## Tests e2e

Suite de bout en bout dans `tests/e2e/` (**hors `src/`** → exclue de la couverture lcov et du package `dist`). Vrai serveur HTTP (Express + `fetch` natif, port éphémère), pas de mocks. Requiert Node ≥ 18.2 ; `express` et `cross-env` sont en devDependencies.

- `tests/e2e/harness/` — harness réutilisable : `buildApp(options?)` (app + routes instrumentées + error handler), `startServer(app)` (port 0 + mode standalone, draine les requêtes in-flight au close), `controls` (gates déterministes, compteurs d'exécution, traçage des `delete`), `runIdempotencySuite(makeApp)` rejouable sur n'importe quel data adapter.
- `tests/e2e/inmemory.e2e.test.ts` — exécute la suite sur l'`InMemoryDataAdapter` par défaut.
- **Erreurs typées** : le middleware fait `res.status(409|417)` puis `next(err)` avec une erreur exportée portant `statusCode`/`status` (`IdempotencyConflictError` 409, `IdempotencyIntentMismatchError` 417, base `IdempotencyError`) ; Express en dérive le bon code nativement, **même sans error handler**. Le handler de `buildApp` (désactivable via `withErrorHandler: false`) sert de référence pour mettre en forme le corps.
- Lancé en CI par un job CircleCI dédié `e2e` ; `package` est gaté sur `test` + `e2e`. Le `pre-push` Husky ne lance PAS les e2e (CI-only).

## Architecture

Sept fichiers source dans `src/`, tout est ré-exporté par `src/index.ts` (barrel). **`errors/idempotencyErrors.ts`** exporte `IdempotencyError` et ses sous-classes `IdempotencyConflictError` (409) / `IdempotencyIntentMismatchError` (417), portées par le middleware sur les chemins 409/417.

**`middleware/idempotency.ts`** — factory `idempotency(options?)` qui instancie un `IdempotencyService` stocké dans une variable de module (**singleton process-wide** : un second appel à la factory écrase le premier) et retourne sa fonction middleware. Les route handlers récupèrent le service via `getSharedIdempotencyService()`.

**`services/idempotencyService.ts`** — toute la logique. Flux du middleware :

1. Pas de header `idempotency-key` → `next()` passthrough total.
2. Clé présente + resource existante → marquage interne du hit (`WeakSet` sur l'instance de service, non spoofable), puis validation d'intention ; si intention invalide → 417 ; **si une réponse cachée est disponible → replay** (statut + body + headers whitelistés) puis `next()`, **quel que soit l'âge de la resource** (une resource complète n'est jamais orpheline) ; sinon, si l'option `processingTimeout` est active et que le lease a expiré (resource **sans** réponse, `createdAt` plus vieux que le timeout) → **takeover** (`delete` puis reprise du traitement — exécution fraîche, pas un hit) ; sinon (traitement encore en cours) → 409.
3. Clé présente + aucune resource → `create` de la resource, hook sur `res.send`, `next()` ; à l'envoi de la réponse, persistance **fire-and-forget** (`update` si le responseValidator accepte, `delete` sinon).

**`models/models.ts`** — trois interfaces de stratégie injectables via `IdempotencyOptions`, avec leurs défauts dans `src/defaults/` :

| Interface | Défaut | Rôle |
|-----------|--------|------|
| `IIdempotencyDataAdapter` | `InMemoryDataAdapter` (non-production, sans TTL) | Persistance des resources clé → requête → réponse |
| `IIdempotencyResponseValidator` | `SuccessfulResponseValidator` (persiste si 2xx) | Décide si la réponse est mise en cache |
| `IIdempotencyIntentValidator` | `DefaultIntentValidator` (url + method + query + body en deep-equal) | Anti-mésusage d'une clé sur une requête différente |

`IIdempotencyDataAdapter` est implémentée par des packages externes (ex. `express-idempotency-mongo-adapter`) : tout changement à cette interface est un breaking change pour l'écosystème.

## Invariants de design (ne pas « corriger »)

- **Le middleware appelle toujours `next()`**, même après avoir rejoué une réponse cachée. C'est voulu (préserver la chaîne de middlewares) : le contrat impose aux handlers d'appeler `isHit(req)` et de `return` si true, et `reportError(req)` en cas d'échec métier (supprime la clé pour permettre un retry). Le corps est enveloppé dans un `try/catch` avec sentinelle `safeNext` : un `next` au plus, et toute erreur adapter/validator est transmise via `next(err)` (jamais d'unhandled rejection).
- **La capture de réponse passe par un monkey-patch de `res.send`** (`sendHook`). `res.json` et `res.sendStatus` délèguent à `send` donc sont couverts ; `res.end` direct et le streaming ne le sont pas — limitation connue.
- **Seul `content-type` est rejoué** parmi les headers de la réponse cachée (whiteliste dans `buildIdempotencyResponse`).
- **`@boundClass` (autobind-decorator) sur `IdempotencyService`** est nécessaire : la fonction middleware est passée détachée de son instance.
- **Une réponse cachée prime toujours sur le takeover** : le flux vérifie `resource.response` (replay) **avant** `isLeaseExpired` (takeover). Une resource complète n'est jamais orpheline, quel que soit l'âge de son `createdAt` ; le lease/takeover (`processingTimeout`) ne concerne que les resources in-progress (sans réponse). Inverser cet ordre plafonnerait la fenêtre d'idempotence à `processingTimeout` au lieu du TTL de l'adapter.
- **Le lease `processingTimeout` repose sur `IdempotencyResource.createdAt`** (estampillé par le middleware au `create`). Le data adapter doit le **persister et le retourner tel quel** ; `canStillPersist` (zombie-write guard) compare le `createdAt` en mémoire au `createdAt` relu pour ne pas écraser la réponse d'un takeover. Un adapter qui régénère `createdAt` casse le mécanisme (cf. `express-idempotency-mongo-adapter` issue #16).

## Pièges connus

- Le hit est marqué via un `WeakSet` côté serveur (`isHit` lit ce set, pas un header) : non spoofable. Un `x-hit` envoyé par le client est ignoré.
- `findByIdempotencyKey` puis `create` n'est pas atomique : la garantie d'unicité sous concurrence repose sur le data adapter. Un échec de `create` est rejoué par un re-fetch (`startProcessingOrConflict`) → resource présente = 409, absente = erreur propagée.
- `convertToIdempotencyRequest` persiste **tous** les headers de la requête originale (y compris `Authorization`).
- TypeScript : `strict: true` mais `strictNullChecks: false` et `noImplicitAny: false` — ne pas supposer la null-safety.

## Git et PRs

- **DCO obligatoire** : toujours committer avec `git commit -s` (`Signed-off-by` correspondant à l'auteur). Le check DCO des PRs échoue sinon ; rattrapage : `git commit --amend -s --no-edit` puis force-push.
- **Workflow fork** : `origin` = fork, `upstream` = `VilledeMontreal`. Brancher depuis `upstream/master`, pousser la branche sur le fork, ouvrir la PR vers `master` d'upstream.

## Conventions du repo

- **README bilingue** : toute modification de doc doit être faite dans les deux sections (anglaise et française) du `README.md`.
- **CHANGELOG.md** au format Keep a Changelog — à mettre à jour pour tout changement notable.
- `examples/simple-use/` contient un exemple exécutable (Docker Compose) qui illustre le contrat `isHit` côté handler.
- Une analyse approfondie de la lib (flux détaillé, risques) est disponible dans `.claude/analysis/library-overview-analysis.md` (local, non versionné).
