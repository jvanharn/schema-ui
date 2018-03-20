import Axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { applyPatch, compare } from 'fast-json-patch';

import {
    JsonSchema,

    JsonPatchOperation,
    SchemaHyperlinkDescriptor,

    IdentityValue,
    IdentityValues,
    EntityIdentity
} from '../models/index';
import { ISchemaAgent, SchemaAgentResponse, SchemaAgentRejection, HeaderDictionary } from './schema-agent';
import { IRelatableSchemaAgent } from './relatable-schema-agent';
import { IAuthenticatedSchemaAgent } from './authenticated-schema-agent';
import { IAgentAuthenticator } from '../authenticators/agent-authenticator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { ICursor } from '../cursors/cursor';
import { CollectionFilterDescriptor } from '../cursors/filterable-cursor';
import { CollectionSortDescriptor } from '../cursors/sortable-cursor';
import { EndpointCursor } from '../cursors/endpoint-cursor';

import { SchemaNavigator } from '../navigator/schema-navigator';
import { ISchemaValidator, AjvSchemaValidator, ValidatorCache } from '../validator/index';

import * as urltemplate from 'url-template';
import * as qs from 'qs';
import * as _ from 'lodash';

import * as debuglib from 'debug';
var debug = debuglib('schema:endpoint:agent');

/**
 * Mimetype for json-patch.
 */
export const jsonPatchMimeType = 'application/json-patch';

/**
 * Schema interpreter and "hyper/media-link" agent.
 *
 * This class makes it possible to read a json-schema and load the links that are defined in it.
 * Makes it easy to use the links used in json-schemas as outlined in the JSON-Schema Hyper schema extension.
 */
export class EndpointSchemaAgent implements ISchemaAgent, IRelatableSchemaAgent, IAuthenticatedSchemaAgent {
    /**
     * The default base url of new instances of the EndpointSchemaAgent.
     */
    public static DefaultBaseUrl: string = '/';

    /**
     * The base url or prefix before href's mentioned in this agent's SchemaHyperlinks.
     */
    public baseUrl: string = String(EndpointSchemaAgent.DefaultBaseUrl);

    /**
     * Custom headers to send with every request.
     */
    public headers: HeaderDictionary = { };

    /**
     * Authenticator to authenticate requests with.
     */
    public authenticator: IAgentAuthenticator;

    /**
     * Validate request-data before sending it to the server.
     */
    public validateRequests: boolean = true;

    /**
     * The validator to help us validate incomming and outgoing requests before they are performed.
     */
    public get validator(): Promise<ISchemaValidator> {
        if (this._validator == null) {
            this._validator = this.getValidator();
        }
        return this._validator;
    }
    public set validator(validator: Promise<ISchemaValidator>) {
        this._validator = validator;
    }
    private _validator: Promise<ISchemaValidator>;

    /**
     * Construct a new schema agent using a SchemaNavigator.
     *
     * @param schema The schema-navigator used to easily extract link information from the schema.
     * @param cache The schema cache to use to fetch schema's not currently known to the agent.
     * @param fetcher The fetcher to enable us to fetch schema's that are currently not available.
     * @param validator The validator to help us validate incomming and outgoing requests before they are performed.
     * @param validators An validator cache instance, that makes it easier to fetch the validator for a schema.
     * @param parent Parent schema for this agent.
     */
    public constructor(
        public readonly schema: SchemaNavigator,
        protected readonly cache: ISchemaCache,
        protected readonly fetcher: ISchemaFetcher,
        validator?: ISchemaValidator | Promise<ISchemaValidator>,
        public readonly validators?: ValidatorCache,
        public readonly parent?: IRelatableSchemaAgent,
    ) {
        if (validator != null) {
            this.validator = Promise.resolve(validator);
        }
    }

    /**
     * Execute the given link definition in the context of the current schema.
     *
     * @param link The hyper(media)link to execute/fetch.
     * @param data (Optionally) The data to send with the request (if the request is an post for example, send as post data, otherwise as query parameters, ...).
     * @param urlData (Optionally) Data object to resolve parameters from the url in. If not set, uses the data object, if that's not set it rejects.
     * @param headers (Optionally) Extra headers to set on the request.
     *
     * @return An promise resolving into the decoded response from the server/service/remote.
     */
    public execute<TRequest, TResponse>(link: SchemaHyperlinkDescriptor, data?: TRequest, urlData?: IdentityValues, headers?: HeaderDictionary): Promise<SchemaAgentResponse<TResponse>> {
        debug(`preparing [${this.schema.root.id}].links.${link.rel}`);

        // Resolve the request schema
        return this.resolveLinkRequestSchema(link)
            .then(requestSchema => {
                // Validate using the request schema (if applicable).
                if (requestSchema != null) {
                    if (!!this.validator && requestSchema.id && requestSchema.id === this.schema.schemaId) {
                        // Validate using the agent validator
                        debug(`validate request against [${this.schema.root.id}] own schema`);
                        return this.validator.then(x => x.validate(data));
                    }

                    let validator = this.getValidator(new SchemaNavigator(requestSchema));
                    debug(`validate request against [${this.schema.root.id}].links.${link.rel}.requestSchema`);
                    return validator.then(x => x.validate(data));
                }
            })
            .then(validation => {
                // Check validation
                if (validation != null && !validation.valid) {
                    debug(`[error] request validation failed against [${this.schema.root.id}].links.${link.rel}.requestSchema: `, validation.errors);
                    throw new AgentValidationError(`Unable to send the message using link "${link.rel}", the request-body was not formatted correctly according to the request-schema included in the link definition.`, validation.errors);
                }

                // Get the headers
                let requestHeaders = _.assign<any, HeaderDictionary, HeaderDictionary>({}, this.headers, headers);
                if (!!this.authenticator) {
                    requestHeaders = this.authenticator.authenticateRequest(requestHeaders);
                }

                // Create the config
                let config: AxiosRequestConfig = {
                    // Resolve the url and set the url data.
                    url: this.rebaseSchemaHyperlinkHref(this.fillSchemaHyperlinkParameters(link.href, urlData || data)),
                    method: link.method || 'GET',
                    headers: requestHeaders,
                    paramsSerializer: function(params) {
                        return qs.stringify(params, { arrayFormat: 'indices' })
                    }
                };

                // Set the data
                if (config.method.toUpperCase() === 'GET') {
                    config.params = data;
                }
                else {
                    config.data = data;
                }

                debug(`configured link ${link.rel} as [${config.method}] ${config.url}`);

                // Return the created request
                return Axios(config) as Promise<AxiosResponse>;
            })
            .then(xhr => {
                debug(`completed [${this.schema.root.id}].links.${link.rel}`);
                var body: any = xhr.data,
                    first: any;

                // If the object only contains one item that is an object, just return that as the object.
                if (_.isObject(xhr.data) && _.size(xhr.data as any) === 1 && (_.isPlainObject(first = _.find(xhr.data as any, x => true)) || _.isArray(first))) {
                    body = first;
                }

                return {
                    code: xhr.status,
                    headers: xhr.headers,
                    body: body
                } as SchemaAgentResponse<TResponse>;
            })
            .catch(mapAxiosErrorToSchemaAgentRejection);
    }

    /**
     * Create a new item for the currently set schema.
     *
     * @param item Values for the item to create.
     * @param urlData (Optionally) Data object to resolve parameters from the url in. If not set, uses the data/item object.
     * @param linkName The name of the link to use to create the item with.
     *
     * @return Promise that resolves into the id of the created product.
     */
    public create<T>(item: T, urlData?: IdentityValues, linkName?: string): Promise<IdentityValues> {
        // Try to fetch the link name
        let link = this.chooseAppropriateLink([
            'create', // The name this library propagates.
            'new',
            'create-form'
        ], linkName);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        // Execute the request
        return this.execute<T, any>(link, item, urlData).then(response => {
            try {
                // Multiple affected probably
                if (_.isArray(response.body)) {
                    return _.map(response.body as any[], x => {
                        // Single affected
                        if (_.isObject(x)) {
                            return this.schema.getIdentityValues(x);
                        }

                        // Probably a single identity item
                        return this.schema.setIdentityValue({}, x);
                    });
                }

                // Single affected
                else if (_.isObject(response.body)) {
                    return this.schema.getIdentityValues(response.body);
                }

                // Probably a single identity item
                else {
                    return this.schema.setIdentityValue({}, response.body);
                }
            }
            catch (err) {
                debug(`[warn] unable to fetch created object's identity:`, err);
                return response.body;
            }
        });
    }

    /**
     * Read an item of the currently set schema.
     *
     * @param identity The identity-value(s) of the entity item to read/fetch, will be used to find variable-ref values in the url.
     * @param linkName The name of the link to use to read the item with.
     *
     * @return An promise that resolves into the requested entity, and adheres to the set link schema, if it is set.
     */
    public read<T>(identity: EntityIdentity, linkName?: string): Promise<T> {
        // Try to fetch the link name
        let link = this.chooseAppropriateLink([
            'read', // The name this library propagates.
            'self', // The official rel name for this kind of method (but not very common).
            'item', // Defined in the Item and Collection rfc6573
            'view',
            'get',
            'current'
        ], linkName);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        // Determine url data
        let urlData: IdentityValues;
        if (!_.isPlainObject(identity)) {
            urlData = {};
            urlData[this.schema.identityProperty] = identity as string;
        }
        else {
            urlData = identity as IdentityValues;
        }

        // Execute the request
        return this.execute<any, T>(link, void 0, urlData)
            .then(response => {
                //@todo validate response.
                return response.body;
            });
    }

    /**
     * Get a cursor for this collection (if the schema supports this) and filter it's contents.
     *
     * @param filters Filter collection
     * @param sorters
     */
    public filter<T>(filters: CollectionFilterDescriptor[], sorters: CollectionSortDescriptor[]): Promise<ICursor<T>> {
        // Try to fetch the link name
        let link = this.schema.getFirstLink([
            'list',
            'collection',
            'search'
        ]);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        let cursor = new EndpointCursor<T>(this, link.rel, null, void 0);
        //@todo actually filter.
        return Promise.resolve(cursor);
    }

    /**
     * Get a cursor for this collection (if the schema supports this).
     *
     * @param page The pagenumber to load initially, set to NULL to load no initial page.
     * @param limit The number of items per page.
     * @param linkName The name of the link to load.
     * @param urlData (Optionally) Data object to resolve parameters from the url in. If not set, uses the data object, if that's not set it rejects.
     *
     * @default page 1
     * @default limit 40
     * @default linkName list
     *
     * @return A promise resolving into the requested cursor.
     */
    public list<T>(page?: number, limit?: number, linkName?: string, urlData?: IdentityValues): Promise<ICursor<T>> {
        // Try to fetch the link name
        let link = this.chooseAppropriateLink([
            'list',
            'collection',
            'search'
        ], linkName);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        return Promise.resolve(new EndpointCursor<T>(this, link.rel, page, limit, urlData));
    }

    /**
     * Update an entity item using an array of patch-operations.
     *
     * The linkName for this method is automatically resolved when unset in the following manner:
     *  - Does the schema have a link by the name of 'patch', 'edit' or 'update'?
     *    - Does it have an 'encType' set of type 'application/json-patch'
     *    - Does it have an explicit request schema set?
     *      - Does it validate the JSON Operations?
     *  - Otherwise reject.
     * If none of these are matched an 'read' operation is executed if possible,
     * the patch operation is applied on the fetched item and is executed using the update operation.
     *
     * @link http://williamdurand.fr/2014/02/14/please-do-not-patch-like-an-idiot/ Why this library only supports sending the whole object or a set of patch changes.
     *
     * @param identity The identity of the entity item to update/fetch.
     * @param ops Update/patch operation to execute on the given item.
     * @param item The complete item that should be the new value for the item with the given identity.
     * @param linkName The name of the link to load.
     * @param urlData (Optionally) Data object to resolve parameters from the url in. If not set, uses the data object, if that's not set it rejects.
     *
     * @return A promise that resolves when the update was succesfull.
     */
    public update(identity: EntityIdentity, ops: JsonPatchOperation[], linkName?: string): Promise<void>;
    public update<T extends { }>(identity: EntityIdentity, item: T, linkName?: string): Promise<void>;
    public update<T extends { }>(identity: EntityIdentity, data: T | JsonPatchOperation[], linkName?: string): Promise<void> {
        // Try to fetch the link name
        let link = this.chooseAppropriateLink([
            'patch', // The name this library propagates.
            'edit', // The official rel name for this kind of method (but not very common).
            'edit-form',
            'update'
        ], linkName);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        // Determine url data
        let urlData: IdentityValues;
        if (!_.isPlainObject(identity)) {
            urlData = {};
            urlData[this.schema.identityProperty] = identity as string;
        }
        else {
            urlData = identity as IdentityValues;
        }

        // Determine the source and target data types.
        let sourcePatch = (_.isArray(data) && !_.isEmpty(data) && !!data[0].op),
            targetPatch = _.startsWith(link.encType, jsonPatchMimeType) ||
                (String(link.method).toUpperCase() === 'PATCH' && !_.startsWith(link.encType, jsonPatchMimeType));

        // Set headers
        let headers: HeaderDictionary = {};
        if (targetPatch) {
            headers['content-type'] = jsonPatchMimeType;
        }

        // Determine body data
        let bodyData: Promise<any>;
        if ((sourcePatch && targetPatch) || (!sourcePatch && !targetPatch)) {
            // Data is already correctly formatted
            bodyData = Promise.resolve(data);
        }
        else if (!sourcePatch && targetPatch) {
            // We need to generate patch ops for the given data object.
            // Read the original object and generate the patch ops.
            bodyData = this.read(urlData).then(original => compare(original, data as T));
        }
        else if (sourcePatch && !targetPatch) {
            // We have patch, and we need to put the whole object.
            // Read the original and apply the patches on it.
            bodyData = this.read(urlData).then(original => {
                applyPatch(original, data as any, true, true);
                return original;
            });
        }

        // Make the request
        return bodyData.then<any>(sendable => this.execute(link, sendable, urlData, headers));
    }


    /**
     * Remove an entity item.
     *
     * @param identity The id of the item to delete.
     * @param linkName The name of the link to load.
     *
     * @return A promise that resolves once the item is succesfully deleted.
     */
    public delete(identity: EntityIdentity, linkName?: string): Promise<void> {
        // Try to fetch the link name
        let link = this.chooseAppropriateLink([
            'delete', // The name this library propagates.
            'remove'
        ], linkName);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to delete with.`);
        }

        // Determine url data
        let urlData: IdentityValues;
        if (!_.isPlainObject(identity)) {
            urlData = {};
            urlData[this.schema.identityProperty] = identity as string;
        }
        else {
            urlData = identity as IdentityValues;
        }

        // Execute the request
        return this.execute<any, void>(link, void 0, urlData)
            .then(response => {
                //@todo determine the response was positive. probably is, because it didnt reject?.
                return void 0;
            });
    }

    /**
     * Get the last parent in this chain.
     */
    public getRoot(): EndpointSchemaAgent {
        var depth = 0,
            last = this;
        while (last.parent != null) {
            if (depth++ > 30) {
                debug('getRoot() exceeded the max parent depth of 30.');
                break;
            }
            last = last.parent as any;
        }

        return last;
    }

    //region IRelatableSchemaAgent
        /**
         * Creates a clone using the same dependencies but no set schema's.
         */
        protected createChild(json: JsonSchema, propertyPrefix?: string, parent: EndpointSchemaAgent = this): EndpointSchemaAgent {
            var agent = new EndpointSchemaAgent(
                new SchemaNavigator(json, propertyPrefix),
                this.cache, this.fetcher, void 0, this.validators, parent);
            agent.baseUrl = this.baseUrl;
            agent.authenticator = this.authenticator;
            return agent;
        }

        /**
         * Creates a child agent for the given schema property.
         *
         * @param propertyName The name of the property to create the sub-schema for.
         * @param propertyPath The path of the property in the json structure.
         *
         * @return A promise resolving in the new sub-agent.
         */
        public createChildByProperty(propertyPath: string): EndpointSchemaAgent;
        public createChildByProperty(propertyName: string): EndpointSchemaAgent {
            // Check if the given item is the field name or an JSON Pointer.
            var path: string;
            if (propertyName[0] === '/') {
                path = propertyName;
            }
            else {
                path = this.schema.getPropertyPointer(propertyName);
            }

            if (path == null) {
                throw new Error('Unknown field, cannot create child agent.');
            }

            // Create the child agent.
            return this.createChild(this.schema.original, path, this);
        }

        /**
         * Creates child agent using the given schema reference.
         *
         * The implementation MAY check if it actually is a child/sibbling.
         *
         * @param schemaId The schema identity or schema reference of the schema that is a child of this one.
         *
         * @return A promise resolving in the new sub-agent.
         */
        public createChildByReference(ref: string): Promise<EndpointSchemaAgent> {
            var linkedSchema: Promise<JsonSchema>, syncSchema: JsonSchema;
            if ((syncSchema = this.schema.getEmbeddedSchema(ref)) != null) {
                linkedSchema = Promise.resolve(syncSchema);
            }
            else if (!!this.cache && (syncSchema = this.cache.getSchema(ref)) != null) {
                linkedSchema = Promise.resolve(syncSchema);
            }
            else if (!!this.fetcher) {
                linkedSchema = this.fetcher.fetchSchema(ref).then(schema => {
                    try {
                        if (!!this.cache && this.cache.getSchema(ref) == null) {
                            this.cache.setSchema(schema);
                        }
                    }
                    catch (e) { /* */ }

                    return schema;
                });
            }
            else {
                return Promise.reject(new Error('unable to resolve the target JsonSchema!'));
            }

            return linkedSchema.then(x => this.createChild(x, void 0));
        }

        /**
         * Creates a sibbling/related schema using the current schema's resources.
         *
         * @param linkName The name of the link to resolve the schema for.
         * @param urlData Any url/context -data to help with resolving if the agent tries to fetch the schema with an options call or similar.
         *
         * @return A promise resolving in the new sub-agent.
         */
        public createChildByLink(linkName: string, urlData?: IdentityValues): Promise<EndpointSchemaAgent> {
            var schemaLink = this.schema.getLink(linkName);
            if (schemaLink == null) {
                throw new Error(`Unable to resolve the link with name "${linkName}" to be able to create a childSchema for it.`);
            }

            var linkedSchema: Promise<JsonSchema>;
            if (!!schemaLink.targetSchema && !!schemaLink.targetSchema.$ref) {
                return this.createChildByReference(schemaLink.targetSchema.$ref);
            }
            else if(!!schemaLink.targetSchema && !!schemaLink.targetSchema.id) {
                linkedSchema = Promise.resolve(schemaLink.targetSchema);
            }
            else {
                return Promise.reject('unable to resolve the target JsonSchema!');
            }

            return linkedSchema.then(x => this.createChild(x, void 0));
        }
    //endregion

    /**
     * Get a validator instance to use and validate the given schema navigator.
     *
     * @param schema (Optionally) the schema to validate for, if not the one associated with this agent.
     */
    public getValidator(schema: SchemaNavigator = this.schema): Promise<ISchemaValidator> {
        if (this.validators != null) {
            return this.validators.getValidator(this.schema);
        }
        return (new AjvSchemaValidator(this.schema, this.cache, this.fetcher)).compilation;
    }

    /**
     * Fill the hyperlink parameters of an Hyperschema href.
     *
     * @param href The link to fill the parameters of.
     * @param data The data object to get the variables out of.
     *
     * @return An url with the parameters filled.
     */
    protected fillSchemaHyperlinkParameters(href: string, data: any): string {
        return urltemplate.parse(href).expand(data);
    }

    /**
     * Resolves the schema to be used to verify the correctness of a request's contents.
     */
    protected resolveLinkRequestSchema(link: SchemaHyperlinkDescriptor): Promise<JsonSchema> {
        // Check if the schema is set on the link itself.
        if (!!link.schema && link.schema.$ref == null && !!link.schema.type) {
            return Promise.resolve(link.schema);
        }

        // Check if the schema is a local reference
        if (!!link.schema && link.schema['$ref'] != null && link.schema['$ref'][0] === '#') {
            return Promise.resolve(this.schema.getEmbeddedSchema(link.schema['$ref']));
        }

        // Check if the schema exists in our cache.
        var schema: JsonSchema;
        if (!!link.schema && link.schema['$ref'] != null && !!(schema = this.cache.getSchema(link.schema['$ref']))) {
            return Promise.resolve(schema);
        }

        // Fetch it using our fetcher instance.
        if (!!link.schema && link.schema['$ref'] != null) {
            return new Promise((resolve, reject) => {
                this.fetcher.fetchSchema(link.schema['$ref'])
                    .then(resolve)
                    .catch(e => resolve(null) || debug(`Unable to find the request schema for link "${link.rel}" with $ref "${link.schema.$ref}":`, e));
            });
        }

        return Promise.resolve(null);
    }

    /**
     * Rebases the schema hyperlink base to the one defined in the settings, so it's compatible with the request function in the base service.
     */
    protected rebaseSchemaHyperlinkHref(href: string): string {
        let url = String(href);
        if (url[0] === '/') {
            url = url.substr(1);
        }
        if (this.baseUrl[this.baseUrl.length - 1] !== '/') {
            return this.baseUrl + '/' + url;
        }
        return this.baseUrl + url;
    }

    /**
     * Helper method to find the correct schema hyperlink for the job.
     */
    protected chooseAppropriateLink(defaults: string[], userRel?: string): SchemaHyperlinkDescriptor | null {
        if (_.isString(userRel)) {
            return this.schema.getLink(userRel);
        }
        return this.schema.getFirstLink(defaults);
    }
}

/**
 * Error thrown when the call doesnt validate.
 */
export class AgentValidationError extends Error {
    public name: string = 'AgentValidationError';
    public code: number = 400;
    public headers: HeaderDictionary = null;
    public token: string = 'INVALID_ENTITY_DOCUMENT';
    public data: any;

    public constructor(message: string, validationErrors?: any) {
        super(message);

        this.data = validationErrors;

        // Set the prototype explicitly.
        (Object as any).setPrototypeOf(this, AgentValidationError.prototype);
    }
}

/**
 * Map an axios error response, or regular error object to an schema agent rejection object.
 *
 * @param {Error & { response: Axios.AxiosXHR<any> }} error The original caught error to map.
 * @throws SchemaAgentRejection
 */
export function mapAxiosErrorToSchemaAgentRejection(error: any): never {
    if (!error.request && !error.response) {
        throw error;
    }
    else if (!error.response) {
        if (error.message === 'Network Error') {
            throw {
                code: 598,
                headers: {},
                token: 'NETWORK_ERROR',
                data: void 0
            } as SchemaAgentRejection;
        }
        throw error;
    }

    var errorToken: string = 'UNKNOWN_ERROR', errorRoot: any, xhr = error.response;
    if (!xhr.data) {
        errorRoot = xhr.data;
        errorToken = xhr.statusText;
    }
    else {
        if (_.size(xhr.data as any) === 1) {
            _.each(xhr.data, x => errorRoot = x);
        }
        else {
            errorRoot = xhr.data;
        }

        if (_.isArray(errorRoot)) {
            errorRoot = _.first(errorRoot);
        }

        let keys = _.keys(errorRoot),
            tokenKey = _.find(keys, x => _.includes(['token', 'message', 'detail'], x.toLowerCase()));
        if (!!tokenKey) {
            errorToken = String(errorRoot[tokenKey]);
        }
    }

    throw {
        code: xhr.status,
        headers: xhr.headers,
        token: _.snakeCase(errorToken).toUpperCase(),
        data: errorRoot
    } as SchemaAgentRejection;
}
