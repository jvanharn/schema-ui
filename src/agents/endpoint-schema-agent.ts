import {
    JsonSchema,

    JsonPatchOperation,
    SchemaHyperlinkDescriptor,

    IdentityValue,
    IdentityValues
} from '../models/index';
import { ISchemaAgent, SchemaAgentResponse, HeaderDictionary } from './schema-agent';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { ICursor } from '../cursors/cursor';
import { CollectionFilterDescriptor } from '../cursors/filterable-cursor';
import { CollectionSortDescriptor } from '../cursors/sortable-cursor';

import { SchemaNavigator } from '../schema-navigator';
import { SchemaValidator } from '../schema-validator';

import * as axios from 'axios';
import * as _ from 'lodash';

import * as debuglib from 'debug';
var debug = debuglib('schema:endpoint:agent');

/**
 * Regular Expression to lift the parameters set in JSON Schema Hyperlink-hrefs.
 */
const urlParameterMatchRegexp = /[^{]+(?=\})/g

/**
 * Schema interpreter and "hyper/media-link" agent.
 *
 * This class makes it possible to read a json-schema and load the links that are defined in it.
 * Makes it easy to use the links used in json-schemas as outlined in the JSON-Schema Hyper schema extension.
 */
export class EndpointSchemaAgent implements ISchemaAgent {
    /**
     * The default base url of new instances of the EndpointSchemaAgent.
     */
    public static DefaultBaseUrl: string = '/';

    /**
     * Parent schema for this agent.
     */
    public readonly parent: ISchemaAgent;

    /**
     * The base url or prefix before href's mentioned in this agent's SchemaHyperlinks.
     */
    public baseUrl: string = String(EndpointSchemaAgent.DefaultBaseUrl);

    /**
     * JSON-Pointer path prefix for properties in this schema.
     */
    public path: string = '/';

    /**
     * Validate request-data before sending it to the server.
     */
    public validateRequests: boolean = true;

    /**
     * Construct a new schema agent using a SchemaNavigator.
     *
     * @param schema The schema-navigator used to easily extract link information from the schema.
     * @param cache The schema cache to use to fetch schema's not currently known to the agent.
     * @param fetcher The fetcher to enable us to fetch schema's that are currently not available.
     * @param validator The validator to help us validate incomming and outgoing requests before they are performed.
     */
    public constructor(
        public readonly schema: SchemaNavigator,
        private readonly cache: ISchemaCache,
        private readonly fetcher: ISchemaFetcher,
        private readonly validator?: SchemaValidator
    ) {
        if (validator == null) {
            this.validator = new SchemaValidator(schema, cache, fetcher);
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
        // Resolve the request schema
        return this.resolveLinkRequestSchema(link)
            .then(requestSchema => {
                // Validate using the request schema (if applicable).
                if (requestSchema != null) {
                    let validator = SchemaValidator.fromSchema(requestSchema, this.cache, this.fetcher);
                    return validator.validate(data);
                }
            })
            .then(validation => {
                // Check validation
                if (validation != null && !validation.valid) {
                    let message = `Unable to send the message using link "${link.rel}", the request-body was not formatted correctly according to the request-schema included in the link definition.`;
                    debug(message, validation.errors);
                    throw new Error(message);
                }

                // Create the config
                let config: Axios.AxiosXHRConfig<TRequest> = {
                    // Resolve the url and set the url data.
                    url: this.fillSchemaHyperlinkParameters(link.href, urlData || data),
                    method: link.method || 'GET',
                    //@todo Design a system that can modify the headers on a per-request, per-schema basis.
                };

                // Return the created request
                return axios<TRequest, TResponse>(config) as Promise<Axios.AxiosXHR<TResponse>>;
            })
            .then(xhr => {
                return {
                    headers: xhr.headers,
                    body: xhr.data
                };
            });
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
    public create<T>(item: T, urlData?: IdentityValues, linkName?: string): Promise<IdentityValue> {
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
        return this.execute<T, any>(link, void 0, urlData).then(response => this.schema.getIdentityValue(response.body));
    }

    /**
     * Read an item of the currently set schema.
     *
     * @param identity The identity of the entity item to read/fetch.
     * @param urldata The identity-values of the entity item to read/fetch, will be used to find variable-ref values in the url.
     * @param linkName The name of the link to use to read the item with.
     *
     * @return An promise that resolves into the requested entity, and adheres to the set link schema, if it is set.
     */
    public read<T>(identity: IdentityValue, linkName?: string): Promise<T>;
    public read<T>(urlData: IdentityValues, linkName?: string): Promise<T>;
    public read<T>(data: IdentityValue | IdentityValues, linkName?: string): Promise<T> {
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
        if (!_.isPlainObject(data)) {
            urlData = {};
            urlData[this.schema.identityProperty] = data as string;
        }
        else {
            urlData = data as IdentityValues;
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

    }

    /**
     * Update an entity item using an array of patch-operations.
     *
     * The linkName for this method is automatically resolved when unset in the following manner:
     *  - Does the schema have a link by the name of 'patch'?
     *  - Does the schema have a link by the name of 'update'?
     *    - Does it have an 'encType' set of type 'application/json-patch'
     *    - Does it have an explicit request schema set?
     *      - Does it validate the JSON Operations?
     *  - No 'patch' or 'update' link? Reject.
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
    public update(identity: IdentityValue, ops: JsonPatchOperation[], linkName?: string, urlData?: IdentityValues): Promise<void>;
    public update<T extends { }>(identity: IdentityValue, item: T, linkName?: string, urlData?: IdentityValues): Promise<void>;
    public update<T extends { }>(identity: IdentityValue, data: T | JsonPatchOperation[], linkName?: string, urlData?: IdentityValues): Promise<void> {

    }


    /**
     * Remove an entity item.
     *
     * @param identity The id of the item to delete.
     * @param linkName The name of the link to load.
     *
     * @return A promise that resolves once the item is succesfully deleted.
     */
    public delete(identity: IdentityValue, linkName?: string, urlData?: IdentityValues): Promise<void> {
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
        if (!_.isPlainObject(urlData)) {
            urlData = {};
        }
        urlData[this.schema.identityProperty] = identity as string;

        // Execute the request
        return this.execute<any, void>(link, void 0, urlData)
            .then(response => {
                //@todo determine the response was positive. probably is, because it didnt reject?.
                return void 0;
            });
    }

    /**
     * Resolves the schema to be used to verify the correctness of a request's contents.
     */
    private resolveLinkRequestSchema(link: SchemaHyperlinkDescriptor): Promise<JsonSchema> {
        // Check if the schema is set on the link itself.
        if (!!link.schema && link.schema.$ref == null && !!link.schema.type) {
            return Promise.resolve(link.schema);
        }

        // Check if the schema exists in our cache.
        var schema: JsonSchema;
        if (!!link.schema && link.schema['$ref'] != null !!(schema = this.cache.getSchema(link.schema['$ref']))) {
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
     * Takes a href (e.g. /api/user/{UserId}) and fills in all the parameters, using the data object.
     *
     * @param href The Href from the schema to resolve, for the given data object.
     * @param data The data object to fetch the values for the parameters from.
     *
     * @return The processed url that can be loaded.
     */
    private fillSchemaHyperlinkParameters(href: string, data: any): string {
        // Fetch params
        var params = this.rebaseSchemaHyperlinkHref(href).match(urlParameterMatchRegexp);
        if(!params || params.length === 0) {
            return href;
        }

        // Replace params
        var result = href + '';
        for(var i = 0; i < params.length; i++) {
            result = result.replace('{' + params[i] + '}', data[params[i]]);
            data[params[i]] = void 0;
        }

        return result;
    }

    /**
     * Rebases the schema hyperlink base to the one defined in the settings, so it's compatible with the request function in the base service.
     */
    private rebaseSchemaHyperlinkHref(href: string): string {
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
    private chooseAppropriateLink(defaults: string[], userRel?: string): SchemaHyperlinkDescriptor | null {
        if (_.isString(userRel)) {
            return this.schema.getLink(userRel);
        }
        return this.schema.getFirstLink(defaults);
    }
}
