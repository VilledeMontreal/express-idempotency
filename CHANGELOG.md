# Changelog

All notable changes to this library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `processingTimeout` option (milliseconds): lease mechanism that allows a retry to take over processing of an in-progress resource after the timeout elapses, preventing permanent `409` locks caused by orphaned requests (crash, OOM, rollout). Opt-in; disabled when absent or `<= 0`. Requires the data adapter to persist and return `IdempotencyResource.createdAt`. (issue #32)
- `IdempotencyResource.createdAt` field (`Date | number`, optional): timestamp stamped unconditionally by the middleware at resource creation. Used by the `processingTimeout` lease mechanism; absent value degrades safely to the v2.0.0 behaviour.

### Fixed

- Resources left in-progress when the response bypasses `res.send` (e.g. `res.end()`, streaming, `sendFile`) are now automatically deleted on the `finish` event, allowing the next retry to be reprocessed instead of receiving a permanent `409`.
- `InMemoryDataAdapter.update` no longer creates a phantom `"-1"` property on the internal array when called with an unknown key; it is now a no-op, aligned with MongoDB `updateOne` semantics.

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

[2.0.0]: https://github.com/VilledeMontreal/express-idempotency/compare/v1.0.5...v2.0.0
[1.0.5]: https://github.com/VilledeMontreal/express-idempotency/releases/tag/v1.0.5
