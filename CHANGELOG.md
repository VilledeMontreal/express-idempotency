# Changelog

All notable changes to this library will be documented in this file.

## 1.0.5

-   Fix: Use of express public api to retrieve request headers ([issue #21](https://github.com/VilledeMontreal/express-idempotency/issues/21))
-   Fix: Add null to possible return value for data adapters when idempotency resource not found ([Issue #22](https://github.com/VilledeMontreal/express-idempotency/issues/22))

## 1.0.4

-   Fix security issues
-   Adjustment to packages
-   Remove unnecessary files

## 1.0.3

-   Fix issue with autobind-decorator which must be a runtime dependency ([issue #10](https://github.com/VilledeMontreal/express-idempotency/issues/10))
-   Upgrade librairies
-   Adjust documentation

## 1.0.2

Fixed issues with scoped dependencies and adjust documentation accordingly.

## 1.0.1

Update package.json with keywords for NPM search engine.

## 1.0.0

This is the first version of the idempotency middleware for express.

Idempotency middleware for express

-   Allows custom data adapter to store idempotency key, request and response data
-   Allows custom intent validator
-   Allows custom response validator
-   Provides docker based example
