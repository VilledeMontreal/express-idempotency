// Copyright (c) Ville de Montreal. All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { boundClass } from 'autobind-decorator';
import { DefaultIntentValidator } from './../defaults/defaultIntentValidator';
import * as express from 'express';
import * as HttpStatus from 'http-status-codes';
import { OutgoingHttpHeaders } from 'http';
import { InMemoryDataAdapter } from './../defaults/inMemoryDataAdapter';
import { SuccessfulResponseValidator } from './../defaults/successfulResponseValidator';
import {
    IdempotencyOptions,
    IdempotencyRequest,
    IdempotencyResource,
    IdempotencyResponse,
} from '../models/models';

// Default values
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

const HIT_HEADER = 'x-hit';
const HIT_VALUE = 'true';

// tslint:disable-next-line:interface-name
interface InternalExpressResponse extends express.Response {
    _headers: any;
}

/**
 * This class represent the idempotency service.
 * It contains all the logic.
 */
@boundClass
export class IdempotencyService {
    private _options: IdempotencyOptions;

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

        // Ensure that every propery has a value.
        this._options = {
            idempotencyKeyHeader,
            dataAdapter,
            responseValidator,
            intentValidator,
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
        // Get the idempotency key to determine if there is something to process
        const idempotencyKey: string = this.extractIdempotencyKeyFromReq(req);
        if (idempotencyKey) {
            res.setHeader(this._options.idempotencyKeyHeader, idempotencyKey);

            // If there is already a resource associated to this idempotency key,
            // there will be 2 scenarios: the previous request is still in progress or there is
            // a response available.
            let resource = await this._options.dataAdapter.findByIdempotencyKey(
                idempotencyKey
            );
            if (resource) {
                // Indicate idempotency exists
                req.headers[HIT_HEADER] = HIT_VALUE;

                // Validate the intent before going any further. This is to avoid misuse of the
                // idempotency key function. This could also lead to security vulnerability
                // because someone could send random key to get response.
                if (
                    this._options.intentValidator.isValidIntent(
                        req,
                        resource.request
                    )
                ) {
                    const availableResponse = resource.response;
                    if (availableResponse) {
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
                        next();
                    } else {
                        // Previous request in progress
                        const conflictError = new Error(
                            'A previous request is still in progress for this key.'
                        );
                        res.status(HttpStatus.CONFLICT);
                        next(conflictError);
                    }
                } else {
                    // Invalid intent. Client must correct his request.
                    const invalidIntentError = new Error(
                        'Misuse of the idempotency key. Please check your request.'
                    );
                    res.status(HttpStatus.EXPECTATION_FAILED);
                    next(invalidIntentError);
                }
            } else {
                // No resource, so initiate the idempotency process
                resource = {
                    idempotencyKey,
                    request: this.convertToIdempotencyRequest(req),
                };
                await this._options.dataAdapter.create(resource);
                this.setupHooks(res, resource);
                next();
            }
        } else {
            next();
        }
    }

    /**
     * Verify if the request is idempotent and so, nothing should be done
     * in term of processing.
     * @param req Request to validate hit
     */
    public isHit(req: express.Request): boolean {
        return req.get(HIT_HEADER) === HIT_VALUE;
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
        // Wait for all promise to come back. To ensure performance,
        // fire and forget.
        const idempotencyKey: string = resource.idempotencyKey;
        Promise.all<[number, OutgoingHttpHeaders], any>([
            this.writeHeadHook(res),
            this.sendHook(res),
        ])
            .then(async ([[statusCode], body]) => {
                // Receive everything required to assemble a idempotency response.
                // logger.info(headers);
                const response = this.buildIdempotencyResponse(
                    res,
                    statusCode,
                    body
                );

                try {
                    // Validate against conditions to determine if valid response
                    if (
                        this._options.responseValidator.isValidForPersistence(
                            response
                        )
                    ) {
                        const newResource: IdempotencyResource = {
                            ...resource,
                            response,
                        };
                        await this._options.dataAdapter.update(newResource);
                    } else {
                        await this._options.dataAdapter.delete(idempotencyKey);
                    }
                } catch (err) {
                    console.log(
                        'Error while validating response for persistence.'
                    );
                    throw err;
                }
            })
            .catch(async () => {
                try {
                    console.log(
                        'Something went wrong, try to remove idempotency...'
                    );
                    await this._options.dataAdapter.delete(idempotencyKey);
                } catch (err) {
                    console.log(
                        'Error while removing idempotency key during failing hook.'
                    );
                }
            });
    }

    /**
     * Hook into writeHead function of response to receive the status code
     * and the headers.
     * @param res
     */
    private writeHeadHook(
        res: express.Response
    ): Promise<[number, OutgoingHttpHeaders]> {
        return new Promise<[number, OutgoingHttpHeaders]>((resolve) => {
            const defaultWriteHead = res.writeHead.bind(res);
            // @ts-ignore
            res.writeHead = (
                statusCode: number,
                reasonPhrase?: any,
                headers?: any
            ) => {
                resolve([statusCode, headers]);
                defaultWriteHead(statusCode, reasonPhrase, headers);
            };
        });
    }

    /**
     * Hook into send function of the response to receive the body.
     * @param res
     */
    private sendHook(res: express.Response): Promise<any> {
        return new Promise<any>((resolve) => {
            const defaultSend = res.send.bind(res);
            // @ts-ignore
            res.send = (body?: any) => {
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
        const preliminaryHeaders = (res as InternalExpressResponse)._headers;
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
}
