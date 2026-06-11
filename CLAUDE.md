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

Hooks Husky : `pre-commit` est vide par design ; `pre-push` exécute `npm run prettier && npm run lint && npm test` — tout doit passer avant un push. `commit-msg` impose Conventional Commits (commitlint).

## Release

CircleCI publie sur npm uniquement sur tag git : `vX.Y.Z` → publication normale, `vX.Y.Z-<suffixe>` → publication avec dist-tag `rc`. Les tests tournent sur toutes les branches ; la couverture (lcov) part vers Codacy. Branches : `master` (production) et `develop`.

## Architecture

Six fichiers source dans `src/`, tout est ré-exporté par `src/index.ts` (barrel).

**`middleware/idempotency.ts`** — factory `idempotency(options?)` qui instancie un `IdempotencyService` stocké dans une variable de module (**singleton process-wide** : un second appel à la factory écrase le premier) et retourne sa fonction middleware. Les route handlers récupèrent le service via `getSharedIdempotencyService()`.

**`services/idempotencyService.ts`** — toute la logique. Flux du middleware :

1. Pas de header `idempotency-key` → `next()` passthrough total.
2. Clé présente + resource existante → injection de `x-hit: true` dans `req.headers`, puis validation d'intention ; si intention invalide → 417 ; si réponse cachée disponible → replay (statut + body + headers whitelistés) puis `next()` ; si traitement encore en cours (resource sans réponse) → 409.
3. Clé présente + aucune resource → `create` de la resource, hook sur `res.send`, `next()` ; à l'envoi de la réponse, persistance **fire-and-forget** (`update` si le responseValidator accepte, `delete` sinon).

**`models/models.ts`** — trois interfaces de stratégie injectables via `IdempotencyOptions`, avec leurs défauts dans `src/defaults/` :

| Interface | Défaut | Rôle |
|-----------|--------|------|
| `IIdempotencyDataAdapter` | `InMemoryDataAdapter` (non-production, sans TTL) | Persistance des resources clé → requête → réponse |
| `IIdempotencyResponseValidator` | `SuccessfulResponseValidator` (persiste si 2xx) | Décide si la réponse est mise en cache |
| `IIdempotencyIntentValidator` | `DefaultIntentValidator` (url + method + query + body en deep-equal) | Anti-mésusage d'une clé sur une requête différente |

`IIdempotencyDataAdapter` est implémentée par des packages externes (ex. `express-idempotency-mongo-adapter`) : tout changement à cette interface est un breaking change pour l'écosystème.

## Invariants de design (ne pas « corriger »)

- **Le middleware appelle toujours `next()`**, même après avoir rejoué une réponse cachée. C'est voulu (préserver la chaîne de middlewares) : le contrat impose aux handlers d'appeler `isHit(req)` et de `return` si true, et `reportError(req)` en cas d'échec métier (supprime la clé pour permettre un retry).
- **La capture de réponse passe par un monkey-patch de `res.send`** (`sendHook`). `res.json` et `res.sendStatus` délèguent à `send` donc sont couverts ; `res.end` direct et le streaming ne le sont pas — limitation connue.
- **Seul `content-type` est rejoué** parmi les headers de la réponse cachée (whiteliste dans `buildIdempotencyResponse`).
- **`@boundClass` (autobind-decorator) sur `IdempotencyService`** est nécessaire : la fonction middleware est passée détachée de son instance.

## Pièges connus

- Le header `x-hit` est lu depuis la requête (`isHit`) : il est spoofable par un client — en tenir compte dans toute évolution de ce mécanisme.
- `findByIdempotencyKey` puis `create` n'est pas atomique : la garantie d'unicité sous concurrence repose sur le data adapter.
- `convertToIdempotencyRequest` persiste **tous** les headers de la requête originale (y compris `Authorization`).
- TypeScript : `strict: true` mais `strictNullChecks: false` et `noImplicitAny: false` — ne pas supposer la null-safety.

## Git et PRs

- **Identité git locale** : `Philippe LAWSON <phil.lawson9@gmail.com>` (compte GitHub `lawp09`), configurée en local dans ce repo — ne pas committer avec l'identité globale `@montreal.ca`.
- **DCO obligatoire** : toujours committer avec `git commit -s` (`Signed-off-by` correspondant à l'auteur). Le check DCO des PRs échoue sinon ; rattrapage : `git commit --amend -s --no-edit` puis force-push.
- **Workflow fork** : `origin` = fork `lawp09`, `upstream` = `VilledeMontreal`. Brancher depuis `upstream/master`, pousser la branche sur le fork, ouvrir la PR vers `master` d'upstream.

## Conventions du repo

- **README bilingue** : toute modification de doc doit être faite dans les deux sections (anglaise et française) du `README.md`.
- **CHANGELOG.md** au format Keep a Changelog — à mettre à jour pour tout changement notable.
- `examples/simple-use/` contient un exemple exécutable (Docker Compose) qui illustre le contrat `isHit` côté handler.
- Une analyse approfondie de la lib (flux détaillé, risques) est disponible dans `.claude/analysis/library-overview-analysis.md` (local, non versionné).
