# Changelog

All notable changes to this library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-06-25

### Added

- Typed, exported error classes — `IdempotencyError` (base) and its subclasses `IdempotencyConflictError` (`409`) and `IdempotencyIntentMismatchError` (`417`) — carrying the HTTP status on both `statusCode` and `status`. Consumers can branch on the concrete type with `instanceof`. (issue #34)
- `processingTimeout` option (milliseconds): lease mechanism that allows a retry to take over processing of an in-progress resource after the timeout elapses, preventing permanent `409` locks caused by orphaned requests (crash, OOM, rollout). Opt-in; disabled when absent or `<= 0`. Requires the data adapter to persist and return `IdempotencyResource.createdAt`. (issue #32)
- `IdempotencyResource.createdAt` field (`Date | number`, optional): timestamp stamped unconditionally by the middleware at resource creation. Used by the `processingTimeout` lease mechanism; absent value degrades safely to the v2.0.0 behaviour.
- End-to-end test suite (`npm run test:e2e`) exercising the middleware over a real HTTP server (Express + native `fetch`): replay/hit, `409` in-progress conflict, concurrent retries, `processingTimeout` takeover, zombie-write guard, phantom-key cleanup (`res.end` bypass), intent mismatch (`417`) and `reportError`. Factored as `runIdempotencySuite` for reuse across data adapters, runnable standalone via `npm run e2e:serve`, and wired as a dedicated CI job.
- `requestHeaderWhitelist` option (`string[]`): case-insensitive whitelist of request headers persisted into the `IdempotencyResource`. Defaults to `['content-type']`; pass `[]` to persist none, or add the header names a custom `intentValidator` needs. (issue #36)

### Changed

- CI and release both run on GitHub Actions; CircleCI has been removed. `ci.yml` runs build, lint, unit and e2e tests (coverage uploaded to Codacy); `release.yml` publishes to npm on version tags via OIDC **trusted publishing** (no long-lived `NPM_TOKEN`) and creates a GitHub Release from the CHANGELOG. Pre-release tags (`vX.Y.Z-<suffix>`) publish under the `rc` dist-tag.

### Fixed

- The distribution build now emits a flat `dist/` layout. Adding the e2e suite under `tests/` had widened TypeScript's inferred `rootDir` to the project root, so `tsc --build tsconfig.dist.json` emitted `dist/src/**` (and bundled `dist/tests/**` into the package), breaking `main`/`typings` (`dist/index.js`, `dist/index.d.ts`) and the `express-idempotency/dist/middleware/idempotency` deep import. The build is now scoped to `src/` via `include` and an explicit `rootDir`. (issue #32)
- Conflicts (`409`) and intent mismatches (`417`) no longer surface as a generic `500` when the application registers no Express error handler: the forwarded errors now carry a status code that Express derives natively. A custom handler remains recommended to shape the response body. (issue #34)
- The async middleware now wraps its body in a `try/catch` and forwards adapter/validator rejections via `next(err)` instead of leaking an unhandled promise rejection — which, under Express 4, would leave the request hanging. A lost `create` race now maps to `409` when a re-fetch confirms a concurrent winner, while a genuine adapter outage is propagated unchanged instead of being masked. (issue #33)
- The idempotency hit marker is no longer derived from a client-controlled `x-hit` request header (spoofable — a forged value made route handlers skip their response, a denial-of-service primitive). It is now tracked server-side via a `WeakSet` keyed on the request object; the public `isHit(req)` API is unchanged. (issue #35)
- Resources left in-progress when the response bypasses `res.send` (e.g. `res.end()`, streaming, `sendFile`) are now automatically deleted on the `finish` event, allowing the next retry to be reprocessed instead of receiving a permanent `409`.
- `InMemoryDataAdapter.update` no longer creates a phantom `"-1"` property on the internal array when called with an unknown key; it is now a no-op, aligned with MongoDB `updateOne` semantics.

### Security

- Request headers are no longer persisted wholesale by data adapters. Previously `convertToIdempotencyRequest` stored the entire `req.headers` object — including `Authorization`, `Cookie` and API keys — into the idempotency resource, exposing those secrets **at rest** for the lifetime of the TTL with a persistent adapter (e.g. the MongoDB adapter). Only a configurable, case-insensitive whitelist is now persisted (default `['content-type']`), so secrets never reach the store. The default intent validator never read headers, so the default configuration keeps the same behaviour. (issue #36)
- Pin patched versions of two **dev-only transitive** dependencies of the test toolchain via npm `overrides`, clearing the recurring Dependabot security-update failure. Dependabot could not apply the fixes automatically because the only resolvable path would have downgraded `nyc` from `18` to `14` (`security_update_not_possible`). The overrides resolve the advisories at the lockfile level; these packages belong to the test/coverage toolchain only and are **not** part of the published package (`files: ["dist"]`), so runtime consumers were never affected.
  - `@babel/core` (pulled by `nyc → istanbul-lib-instrument`) pinned to `^7.29.6`, fixing GHSA-4x5r-pxfx-6jf8 (arbitrary file read via `sourceMappingURL`, low).
  - `js-yaml` pinned to `^4.2.0`, removing the vulnerable `3.14.2` copy pulled by `nyc → @istanbuljs/load-nyc-config` and fixing GHSA-h67p-54hq-rp68 (quadratic-complexity DoS in merge-key handling, moderate).

## [2.0.0] - 2025-11-05

### 🎉 Major Upgrade - All Dependencies Updated

This release represents a complete modernization of the project after 4 years without updates.

### ⚠️ BREAKING CHANGES

#### For Package Consumers
- **Minimum TypeScript version**: Now requires TypeScript 5.0+
- **Minimum Node.js version**: Now requires Node.js 18.0+
- **Express types**: Updated to @types/express v5, may require type adjustments

#### For Contributors
- **ESLint 9**: New flat config format (`eslint.config.js` instead of `.eslintrc`)
- **Husky 9**: New hooks system (`.husky/` directory instead of package.json config)
- **Prettier 3**: Updated formatting rules
- **Faker replaced**: Now using `@faker-js/faker` instead of deprecated `faker`

### 🔒 Security

- **Fixed 9 vulnerabilities** (3 critical, 5 high, 1 low)
  - Fixed critical Prototype Pollution in `flat` package
  - Fixed critical vulnerabilities in `mocha` dependencies
  - Fixed high severity ReDoS in `semver` and `minimatch`
  - **Result: 0 vulnerabilities** 🎉

### 📦 Dependency Updates

#### Development Dependencies
- TypeScript: 3.9.10 → 5.9.3
- ESLint: 7.32.0 → 9.39.1
- Prettier: 2.0.5 → 3.6.2
- Mocha: 7.2.0 → 11.7.5
- Chai: 4.2.0 → 6.2.0
- Sinon: 9.2.4 → 21.0.0
- Husky: 4.3.8 → 9.1.7
- @commitlint/cli: 11.0.0 → 20.1.0
- @typescript-eslint/*: 3.10.1 → 8.46.3
- And many more...

#### Types
- @types/express: 4.17.13 → 5.0.5
- @types/express-serve-static-core: 4.17.26 → 5.1.0
- All other @types packages updated

#### Production Dependencies
- http-status-codes: 1.4.0 → 2.3.0
- deep-equal: 2.0.3 → 2.2.3

### ✨ Added

- Added `engines` field requiring Node.js 18+
- Added modern ESLint flat config
- Added Husky 9 Git hooks in `.husky/` directory
- Added comprehensive migration plan documentation

### 🔧 Changed

- Updated TypeScript target from ES2015 to ES2020
- Migrated from deprecated `faker` to `@faker-js/faker`
- Modernized all tooling and configurations

### 🗑️ Removed

- Removed deprecated `faker` package
- Removed `.eslintrc` (replaced by `eslint.config.js`)
- Removed `.eslintignore` (integrated into config)

### ✅ Testing

- All 18 tests passing
- 100% backward compatible public API
- Zero npm audit vulnerabilities

---

## [1.0.6]

-   Fix: Remove writeHeadHook promise to persiste the response in case of a client timeout occurs ([issue #26](https://github.com/VilledeMontreal/express-idempotency/issues/26))
  
---

## [1.0.5] - 2021-XX-XX

### Fixed
- Fix: Use of express public api to retrieve request headers ([issue #21](https://github.com/VilledeMontreal/express-idempotency/issues/21))
- Fix: Add null to possible return value for data adapters when idempotency resource not found ([Issue #22](https://github.com/VilledeMontreal/express-idempotency/issues/22))

---

## [1.0.4] - 2021-XX-XX

### Fixed
- Fix security issues
- Adjustment to packages
- Remove unnecessary files

---

## [1.0.3] - 2020-XX-XX

### Fixed
- Fix issue with autobind-decorator which must be a runtime dependency ([issue #10](https://github.com/VilledeMontreal/express-idempotency/issues/10))

### Changed
- Upgrade librairies
- Adjust documentation

---

## [1.0.2] - 2020-XX-XX

### Fixed
- Fixed issues with scoped dependencies and adjust documentation accordingly

---

## [1.0.1] - 2020-XX-XX

### Changed
- Update package.json with keywords for NPM search engine

---

## [1.0.0] - 2020-XX-XX

### Added
- Initial release of idempotency middleware for Express
- Allows custom data adapter to store idempotency key, request and response data
- Allows custom intent validator
- Allows custom response validator
- Provides docker based example

---

## Migration Guide

For detailed migration instructions from 1.0.x to 2.0.0, see [MIGRATION_PLAN.md](./MIGRATION_PLAN.md).

### Quick Migration Steps

1. **Update Node.js**: Ensure you're using Node.js 18 or higher
2. **Update TypeScript**: Upgrade to TypeScript 5.0 or higher
3. **Install**: `npm install express-idempotency@2.0.0`
4. **Test**: Run your tests to ensure type compatibility

[2.1.0]: https://github.com/VilledeMontreal/express-idempotency/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/VilledeMontreal/express-idempotency/compare/v1.0.5...v2.0.0
[1.0.5]: https://github.com/VilledeMontreal/express-idempotency/releases/tag/v1.0.5
