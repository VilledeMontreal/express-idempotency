// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { boundClass } from 'autobind-decorator';
import { DefaultIntentValidator } from './../defaults/defaultIntentValidator';
import * as express from 'express';
import * as HttpStatus from 'http-status-codes';
import { InMemoryDataAdapter } from './../defaults/inMemoryDataAdapter';
import { SuccessfulResponseValidator } from './../defaults/successfulResponseValidator';
import {
    IdempotencyOptions,
    IdempotencyRequest,
    IdempotencyResource,
    IdempotencyResponse,
} from '../models/models';
import {
    IdempotencyConflictError,
    IdempotencyIntentMismatchError,
} from '../errors/idempotencyErrors';

// Default values
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * This class represent the idempotency service.
 * It contains all the logic.
 */
@boundClass
export class IdempotencyService {
    private _options: IdempotencyOptions;

    /**
     * Server-side set of requests already marked as an idempotency hit. Keyed on
     * the request object itself so a client cannot spoof a hit by sending a
     * header. Entries are garbage-collected once the request is released.
     */
    private _hits = new WeakSet<express.Request>();

    /**
     * Constructor, used to initialize default values if options are not provided.
     * @param options Options provided
     */
    constructor(options: IdempotencyOptions = {}) {
        // Default values or provided values
        const idempotencyKeyHeader =
            options.idempotencyKeyHeader ?? IDEMPOTENCY_KEY_HEADER;
        const dataAdapter = options.dataAdapter ?? new InMemoryDataAdapter();
        const responseValidator =
            options.responseValidator ?? new SuccessfulResponseValidator();
        const intentValidator =
            options.intentValidator ?? new DefaultIntentValidator();

        // Normalise processingTimeout: absent/0/negative/non-finite = feature disabled (0).
        const processingTimeout =
            typeof options.processingTimeout === 'number' &&
            isFinite(options.processingTimeout) &&
            options.processingTimeout > 0
                ? options.processingTimeout
                : 0;

        // Ensure that every propery has a value.
        this._options = {
            idempotencyKeyHeader,
            dataAdapter,
            responseValidator,
            intentValidator,
            processingTimeout,
        };
    }

    /**
     * Provide middleware function to enable idempotency.
     * @param req Express request
     * @param res Express response
     * @param next Express next function
     */
    public async provideMiddlewareFunction(
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ): Promise<void> {
        // Guard against a double next() across the branches below and ensure any
        // rejected adapter/validator call is forwarded to the Express error
        // pipeline instead of leaking an unhandled promise rejection (which, under
        // Express 4, would leave the request hanging).
        let nextCalled = false;
        const safeNext: express.NextFunction = (err?: any) => {
            if (nextCalled) {
                return;
            }
            nextCalled = true;
            next(err);
        };

        try {
            // Get the idempotency key to determine if there is something to process
            const idempotencyKey: string =
                this.extractIdempotencyKeyFromReq(req);
            if (idempotencyKey) {
                res.setHeader(
                    this._options.idempotencyKeyHeader,
                    idempotencyKey
                );

                // If there is already a resource associated to this idempotency key,
                // there will be 2 scenarios: the previous request is still in progress or there is
                // a response available.
                const resource =
                    await this._options.dataAdapter.findByIdempotencyKey(
                        idempotencyKey
                    );
                if (resource) {
                    // Validate the intent before going any further. This is to avoid misuse of the
                    // idempotency key function. This could also lead to security vulnerability
                    // because someone could send random key to get response.
                    if (
                        !this._options.intentValidator.isValidIntent(
                            req,
                            resource.request
                        )
                    ) {
                        // Invalid intent. Client must correct his request.
                        res.status(HttpStatus.EXPECTATION_FAILED);
                        safeNext(new IdempotencyIntentMismatchError());
                    } else if (this.isLeaseExpired(resource)) {
                        // Orphaned in-progress resource: a previous request started but never
                        // persisted its response. Take over processing — this is a fresh
                        // execution, not a hit.
                        await this._options.dataAdapter.delete(idempotencyKey);
                        const newResource: IdempotencyResource = {
                            idempotencyKey,
                            request: this.convertToIdempotencyRequest(req),
                            createdAt: new Date(),
                        };
                        await this.startProcessingOrConflict(
                            res,
                            newResource,
                            safeNext
                        );
                    } else {
                        const availableResponse = resource.response;
                        if (availableResponse) {
                            // A cached response is available: this request is an
                            // idempotency hit. Tracked server-side (not via a request
                            // header) so a client cannot spoof a hit.
                            this._hits.add(req);
                            // Set original headers
                            for (const header of Object.keys(
                                availableResponse.headers
                            )) {
                                res.setHeader(
                                    header,
                                    availableResponse.headers[header]
                                );
                            }
                            // Send saved response if available
                            res.status(availableResponse.statusCode).send(
                                availableResponse.body
                            );
                            safeNext();
                        } else {
                            // Previous request in progress
                            res.status(HttpStatus.CONFLICT);
                            safeNext(new IdempotencyConflictError());
                        }
                    }
                } else {
                    // No resource, so initiate the idempotency process
                    const newResource: IdempotencyResource = {
                        idempotencyKey,
                        request: this.convertToIdempotencyRequest(req),
                        createdAt: new Date(),
                    };
                    await this.startProcessingOrConflict(
                        res,
                        newResource,
                        safeNext
                    );
                }
            } else {
                safeNext();
            }
        } catch (err) {
            // Any unexpected adapter/validator failure is forwarded to Express
            // rather than becoming an unhandled rejection.
            safeNext(err);
        }
    }

    /**
     * Verify if the request is idempotent and so, nothing should be done
     * in term of processing.
     * @param req Request to validate hit
     */
    public isHit(req: express.Request): boolean {
        return this._hits.has(req);
    }

    /**
     * Indicate that an error occurs during targeted process and idempotency must not occurs.
     * @param req Request to report in error
     */
    public async reportError(req: express.Request): Promise<void> {
        const idempotencyKey = this.extractIdempotencyKeyFromReq(req);
        await this._options.dataAdapter.delete(idempotencyKey);
    }

    /**
     * Convert a request into a idempotency request which keeps only minimal representation.
     * @param req
     */
    private convertToIdempotencyRequest(
        req: express.Request
    ): IdempotencyRequest {
        return {
            body: req.body,
            headers: req.headers,
            method: req.method,
            query: req.query,
            url: req.url,
        };
    }

    /**
     * Extract idempotency key from request.
     * @param req
     */
    public extractIdempotencyKeyFromReq(req: express.Request): string {
        return req.get(this._options.idempotencyKeyHeader);
    }

    /**
     * Override function, which is the correct way. But Typescript won't allow it because there is multiple overloads.
     * @param res
     * @param resource
     */
    private setupHooks(
        res: express.Response,
        resource: IdempotencyResource
    ): void {
        // Wait for send() to be called to build the Response. To ensure performance,
        // fire and forget.
        const idempotencyKey: string = resource.idempotencyKey;

        // Tracks whether res.send was called. Set synchronously inside the
        // monkey-patched send so the finish handler can distinguish a normal
        // send path from a bypass (res.end / streaming / sendFile).
        let settled = false;

        // Cleanup hook: fires when the HTTP response is fully flushed. If
        // res.send was never called (settled is false), the body was not
        // captured — delete the resource so the next retry is processed
        // fresh instead of receiving a permanent 409.
        res.once('finish', () => {
            if (settled) {
                return;
            }
            this.logWarning(
                'Response sent without res.send — idempotency resource will be deleted.'
            );
            this.canStillPersist(resource)
                .then(async (canPersist) => {
                    if (canPersist) {
                        await this._options.dataAdapter.delete(idempotencyKey);
                    }
                })
                .catch(() => {
                    this.logWarning(
                        'Error while deleting idempotency resource after finish without send.'
                    );
                });
        });

        this.sendHook(res, () => {
            settled = true;
        })
            .then(async (body) => {
                // Receive everything required to assemble a idempotency response.
                // logger.info(headers);
                const response = this.buildIdempotencyResponse(
                    res,
                    res.statusCode,
                    body
                );

                try {
                    // Validate against conditions to determine if valid response
                    if (
                        this._options.responseValidator.isValidForPersistence(
                            response
                        )
                    ) {
                        if (await this.canStillPersist(resource)) {
                            const updatedResource: IdempotencyResource = {
                                ...resource,
                                response,
                            };
                            await this._options.dataAdapter.update(
                                updatedResource
                            );
                        }
                    } else {
                        if (await this.canStillPersist(resource)) {
                            await this._options.dataAdapter.delete(
                                idempotencyKey
                            );
                        }
                    }
                } catch (err) {
                    this.logWarning(
                        'Error while validating response for persistence.'
                    );
                    throw err;
                }
            })
            .catch(async () => {
                try {
                    this.logWarning(
                        'Something went wrong, try to remove idempotency...'
                    );
                    if (await this.canStillPersist(resource)) {
                        await this._options.dataAdapter.delete(idempotencyKey);
                    }
                } catch {
                    this.logWarning(
                        'Error while removing idempotency key during failing hook.'
                    );
                }
            });
    }

    /**
     * Hook into send function of the response to receive the body.
     * The optional `onSend` callback is invoked synchronously as the very first
     * thing inside the patched send, before the promise resolves — this ensures
     * any flag (e.g. `settled`) is set before the `finish` event fires.
     * @param res
     * @param onSend Optional synchronous callback invoked when send is called
     */
    private sendHook(res: express.Response, onSend?: () => void): Promise<any> {
        return new Promise<any>((resolve) => {
            const defaultSend = res.send.bind(res);
            // @ts-ignore
            res.send = (body?: any) => {
                if (onSend) {
                    onSend();
                }
                resolve(body);
                defaultSend(body);
            };
        });
    }

    /**
     * Build idempotency response from hook responses and the response itself.
     * @param res
     * @param statusCode
     * @param body
     */
    private buildIdempotencyResponse(
        res: express.Response,
        statusCode: number,
        body: any
    ): IdempotencyResponse {
        const headerWhitelist: string[] = ['content-type'];
        const preliminaryHeaders = res.getHeaders();

        // Keeps only whitelisted headers
        const headers = Object.keys(preliminaryHeaders)
            .filter((key) => headerWhitelist.includes(key))
            .reduce((obj: any, key) => {
                obj[key] = preliminaryHeaders[key];
                return obj;
            }, {});

        return {
            statusCode,
            body,
            headers,
        };
    }

    /**
     * Initiate processing for a new (or taken-over) resource, translating a failed
     * `create` into the correct outcome.
     *
     * `findByIdempotencyKey` then `create` is not atomic, so two strictly
     * concurrent requests with the same key can both reach `create`; the loser
     * gets a duplicate-key rejection from the data adapter. Rather than letting
     * that bubble up as a `500`, we re-check the store: if a resource now exists,
     * a concurrent request won the race and we surface the standard `409`
     * Conflict; otherwise the failure is a genuine adapter outage and is
     * propagated unchanged. This makes the adapter's unique constraint — not a
     * lucky read — the real concurrency guarantee.
     * @param res Express response
     * @param resource Freshly built resource (with createdAt stamped)
     * @param next Guarded next function from the caller (safeNext)
     */
    private async startProcessingOrConflict(
        res: express.Response,
        resource: IdempotencyResource,
        next: express.NextFunction
    ): Promise<void> {
        try {
            await this._options.dataAdapter.create(resource);
        } catch (err) {
            const existing = await this._options.dataAdapter
                .findByIdempotencyKey(resource.idempotencyKey)
                .catch(() => null);
            if (existing) {
                // A concurrent request won the unique-key constraint.
                res.status(HttpStatus.CONFLICT);
                next(new IdempotencyConflictError());
            } else {
                // No resource present: a real adapter failure, not a race.
                next(err);
            }
            return;
        }
        this.setupHooks(res, resource);
        next();
    }

    /**
     * Parse a `createdAt` value into a Unix timestamp (ms).
     * Accepts a Date object, a numeric epoch, or a string that can be parsed by
     * the Date constructor (e.g. ISO 8601 produced by JSON serialisation of a Date).
     * Returns null when the value is absent, not parseable, or results in NaN.
     * @param value Raw createdAt value from the resource
     */
    private parseCreatedAt(value: Date | number | any): number | null {
        // The Date constructor would coerce null to epoch 0 — reject it explicitly.
        // An absent value yields an invalid date, handled by the NaN guard below.
        if (value === null) {
            return null;
        }
        const ms = new Date(value).getTime();
        return isNaN(ms) ? null : ms;
    }

    /**
     * Determine whether the in-progress lease for the given resource has expired.
     * Returns false (not expired) when processingTimeout is disabled, when createdAt
     * is absent or non-parseable, or when the resource is still within the timeout window.
     * @param resource Resource to evaluate
     */
    private isLeaseExpired(resource: IdempotencyResource): boolean {
        const timeout = this._options.processingTimeout;
        if (!timeout) {
            return false;
        }
        const ageMs = this.parseCreatedAt(resource.createdAt);
        if (ageMs === null) {
            return false;
        }
        return Date.now() - ageMs > timeout;
    }

    /**
     * Determine whether the current hook is still the legitimate owner of the resource
     * and is allowed to persist its response. Guards against zombie writes after a
     * takeover has occurred.
     * On the nominal path (age within timeout or timeout disabled) returns true with no
     * extra adapter read. Only performs a refetch when our own lease has already expired.
     * @param resource The resource snapshot captured at hook setup time
     */
    private async canStillPersist(
        resource: IdempotencyResource
    ): Promise<boolean> {
        if (!this.isLeaseExpired(resource)) {
            return true;
        }
        // Our lease has expired — refetch to check whether a takeover replaced us.
        const current = await this._options.dataAdapter.findByIdempotencyKey(
            resource.idempotencyKey
        );
        const stillOwner =
            current &&
            this.parseCreatedAt(current.createdAt) ===
                this.parseCreatedAt(resource.createdAt);
        if (!stillOwner) {
            this.logWarning(
                'Skipping late persistence: resource was taken over by a newer request.'
            );
        }
        return !!stillOwner;
    }

    /**
     * Emit an internal warning. Centralised so it can be replaced by a
     * pluggable logger in a future release without touching call sites.
     * @param message Warning message
     */
    private logWarning(message: string): void {
        // eslint-disable-next-line no-console
        console.warn(message);
    }
}
