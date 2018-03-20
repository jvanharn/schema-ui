import { applyPatch } from 'fast-json-patch';

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
import { AgentValidationError } from './endpoint-schema-agent';
import { IAgentAuthenticator } from '../authenticators/agent-authenticator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { ICursor } from '../cursors/cursor';
import { CollectionFilterDescriptor, getSanitizedFilters } from '../cursors/filterable-cursor';
import { CollectionSortDescriptor, getSanitizedSorters } from '../cursors/sortable-cursor';
import { ValueCursor } from '../cursors/value-cursor';

import { SchemaNavigator } from '../navigator/schema-navigator';
import { ISchemaValidator, AjvSchemaValidator, ValidatorCache } from '../validator/index';

import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:value:agent');

/**
 * Schema interpreter and "hyper/media-link" agent for pre-determined value sets.
 *
 * This schema agent provides an schema agent implementation based on static data sets. Usefull for debugging, testing
 * and local or client data storage. It works on a simple array of values.
 */
export class ValueSchemaAgent<T> implements ISchemaAgent {
    /**
     * Custom headers to send with every request.
     */
    public headers: HeaderDictionary = { };

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
     * Get the current data set as mutated.
     */
    public get data(): ReadonlyArray<T> {
        return this._wrapped;
    }

    /**
     * The largest identity number currently in the collection.
     */
    private identitySerial: number = 1;

    /**
     * Schema of the identity property.
     */
    private identitySchema: JsonSchema;

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
        private readonly _wrapped: T[],
        public readonly schema: SchemaNavigator,
        protected readonly cache: ISchemaCache,
        protected readonly fetcher: ISchemaFetcher,
        validator?: ISchemaValidator | Promise<ISchemaValidator>,
        public readonly validators?: ValidatorCache
    ) {
        if (validator != null) {
            this.validator = Promise.resolve(validator);
        }

        // Get the identity schema
        this.identitySchema = _.first(this.schema.getFieldDescriptorForPointer(this.schema.identityPointer));

        // Update the serial
        if (_wrapped != null && _wrapped.length > 0 && this.identitySchema && (this.identitySchema.type === 'integer' || this.identitySchema.type === 'number')) {
            try {
                this.identitySerial = schema.getIdentityValue(_.maxBy(_wrapped, x => schema.getIdentityValue(x))) as number + 1;
            }
            catch (e) {
                debug(`unable to determine the maximum primary key value, therefore initialized the identity serial to a random number`);
                this.identitySerial = Math.floor(Math.random() * 1000) + 100;
            }
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

        if (!urlData) {
            urlData = data as any;
        }

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

                debug(`completed [${this.schema.root.id}].links.${link.rel}`);

                switch (link.method) {
                    case 'POST':
                        return this.create(data, urlData)
                            .then(x => ({
                                code: 200,
                                headers: {},
                                body: x as any
                            } as SchemaAgentResponse<TResponse>));
                    case 'PUT':
                        return this.update(this.schema.getIdentityValues(urlData || data as any), data as any)
                            .then(x => ({
                                code: 200,
                                headers: {},
                                body: x as any
                            } as SchemaAgentResponse<TResponse>));
                    case 'DELETE':
                        return this.delete(this.schema.getIdentityValues(urlData || data as any))
                            .then(x => ({
                                code: 200,
                                headers: {},
                                body: x as any
                            } as SchemaAgentResponse<TResponse>));
                    case 'GET':
                        if (link.rel.startsWith('list')) {
                            let listPage = urlData ? parseInt(urlData['page'] as any, 10) : 1,
                                listLimit = urlData ? parseInt(urlData['limit'] as any, 10) : void 0,
                                listFilters: CollectionFilterDescriptor[] = [],
                                listSorters: CollectionSortDescriptor[] = [];
                            if (data && (data as any).page) {
                                listPage = (data as any).page;
                            }
                            if (data && (data as any).limit) {
                                listLimit = (data as any).limit;
                            }
                            if (data && (data as any).filters) {
                                listFilters = getSanitizedFilters(data);
                            }
                            if (data && (data as any).sorters) {
                                listSorters = getSanitizedSorters(data);
                            }
                            return this.list<any>(null, listLimit, link.rel, urlData)
                                .then((cursor: ValueCursor<any>) => {
                                    cursor.filterBy(listFilters, true);
                                    cursor.sortBy(listSorters, true);
                                    return cursor.select(listPage);
                                })
                                .then(x => ({
                                    code: 200,
                                    headers: {},
                                    body: x as any
                                } as SchemaAgentResponse<TResponse>));
                        }
                        else {
                            return this.read(urlData)
                                .then(item => {
                                    if (item == null) {
                                        throw { code: 404 } as SchemaAgentRejection;
                                    }
                                    return {
                                        code: 200,
                                        headers: {},
                                        body: item as any
                                    } as SchemaAgentResponse<TResponse>;
                                });
                        }
                    default:
                        throw new Error('Unsupported link method!');
                }
            })
            .catch(err => {
                throw {
                    code: 500,
                    data: err
                } as SchemaAgentRejection;
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
    public create<TItem>(item: TItem, urlData?: IdentityValues, linkName?: string): Promise<IdentityValues> {
        // Try to fetch the link name
        let link = this.chooseAppropriateLink([
            'create', // The name this library propagates.
            'new',
            'create-form'
        ], linkName);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        return this.resolveLinkRequestSchema(link)
            .then(requestSchema => {
                // Validate using the request schema (if applicable).
                if (requestSchema != null) {
                    if (!!this.validator && requestSchema.id && requestSchema.id === this.schema.schemaId) {
                        // Validate using the agent validator
                        debug(`validate request against [${this.schema.root.id}] own schema`);
                        return this.validator.then(x => x.validate(item));
                    }

                    let validator = this.getValidator(new SchemaNavigator(requestSchema));
                    debug(`validate request against [${this.schema.root.id}].links.${link.rel}.requestSchema`);
                    return validator.then(x => x.validate(item));
                }
            })
            .then(validation => {
                // Check validation
                if (validation != null && !validation.valid) {
                    debug(`[error] request validation failed against [${this.schema.root.id}].links.${link.rel}.requestSchema: `, validation.errors);
                    throw new AgentValidationError(`Unable to send the message using link "${link.rel}", the request-body was not formatted correctly according to the request-schema included in the link definition.`, validation.errors);
                }

                // Generate identity if required.
                try {
                    if (item && this.schema.getIdentityValue(item) == null) {
                        this.schema.setIdentityValue(item, this.generateIdentity());
                    }
                }
                catch (e) {
                    this.schema.setIdentityValue(item, this.generateIdentity());
                }

                // Add the item.
                this._wrapped.push(item as any);
                debug(`created [${this.schema.root.id}].links.${link.rel}`);

                return this.schema.getIdentityValues(item);
            })
            .catch(err => {
                throw {
                    code: 500,
                    data: err
                } as SchemaAgentRejection;
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
    public read(identity: EntityIdentity, linkName?: string): Promise<T> {
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

        // Find the item
        var item = _.find(this._wrapped, this.itemMatcher(identity));
        if (_.isObject(item)) {
            item = _.assign({}, item);
        }

        // Resolve
        return Promise.resolve(item);
    }

    /**
     * Get a cursor for this collection (if the schema supports this) and filter it's contents.
     *
     * @param filters Filter collection
     * @param sorters
     */
    public filter<TItem>(filters: CollectionFilterDescriptor[], sorters: CollectionSortDescriptor[]): Promise<ICursor<TItem>> {
        // Try to fetch the link name
        let link = this.schema.getFirstLink([
            'list',
            'collection',
            'search'
        ]);
        if (!link) {
            return Promise.reject(`Couldn't find a usable schema hyperlink name to read with.`);
        }

        var cursor = new ValueCursor<TItem>(this.schema, this._wrapped as any, 1);
        if (filters == null) {
            cursor.filterBy(filters, true);
        }
        if (sorters == null) {
            cursor.sortBy(sorters, true);
        }
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
    public list<TItem>(page?: number, limit?: number, linkName?: string, urlData?: IdentityValues): Promise<ICursor<TItem>> {
        var cursor = new ValueCursor<TItem>(this.schema, this._wrapped as any, page);
        cursor.limit = limit;
        return Promise.resolve(cursor);
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

        // Determine the source and target data types.
        let sourcePatch = (_.isArray(data) && !_.isEmpty(data) && !!data[0].op),
            matcher = this.itemMatcher(identity);

        // Execute the update
        if (sourcePatch) {
            var original = _.find(this._wrapped, matcher);
            if (original) {
                applyPatch(original, data as any, true, true);
                return Promise.resolve(identity) as any;
            }
        }
        else {
            var index = _.findIndex(this._wrapped, matcher);
            if (index >= 0) {
                this._wrapped.splice(index, 1, data as any);
                return Promise.resolve(identity) as any;
            }
        }

        // Make the request
        return Promise.reject({ code: 404, data: 'unable to read the item' } as SchemaAgentRejection);
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

        // Execute the request
        var index = _.findIndex(this._wrapped, this.itemMatcher(identity));
        if (index >= 0) {
            var removed = _.first(this._wrapped.splice(index, 1));
            return Promise.resolve(this.schema.getIdentityValues(removed)) as any;
        }
        return Promise.reject({ code: 404, data: 'couldnt remove non-existent item' } as SchemaAgentRejection);
    }

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
     * Get the next identity values for this agent.
     */
    public generateIdentity(): IdentityValue {
        switch (this.identitySchema.type) {
            case 'string':
                return Math.random().toString(36).substring(this.identitySchema.maxLength || this.identitySchema.maxLength || 26);
            case 'integer':
            case 'number':
                return this.identitySerial++;
            default:
                throw new Error('Unable to generate an identity value for the current schema.');
        }
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
        if (!!link.schema && link.schema['$ref'] != null && this.fetcher != null) {
            return new Promise((resolve, reject) => {
                this.fetcher.fetchSchema(link.schema['$ref'])
                    .then(resolve)
                    .catch(e => resolve(null) || debug(`Unable to find the request schema for link "${link.rel}" with $ref "${link.schema.$ref}":`, e));
            });
        }

        return Promise.resolve(null);
    }

    /**
     * Matches the items.
     * @param urlData
     */
    private itemMatcher(identity: EntityIdentity): (item: any) => boolean {
        // Determine identity
        let urlData: IdentityValues;
        if (!_.isPlainObject(identity)) {
            urlData = {};
            urlData[this.schema.identityProperty] = identity as string;
        }
        else {
            urlData = identity as IdentityValues;
        }

        var props = _.keys(urlData);
        return (item: any) => {
            for (let prop of props) {
                if (item[prop] !== urlData[prop]) {
                    return false;
                }
            }
            return true;
        };
    }
}
