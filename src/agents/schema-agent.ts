import {
    JsonSchema,
    JsonFormSchema,
    JsonTableSchema,

    JsonPatchOperation,
    SchemaHyperlinkDescriptor,

    IdentityValue,
    IdentityValues,
    EntityIdentity
} from '../models/index';
import { SchemaNavigator } from '../navigator/schema-navigator';
import { ICursor } from '../cursors/cursor';
import { CollectionFilterDescriptor } from '../cursors/filterable-cursor';
import { CollectionSortDescriptor } from '../cursors/sortable-cursor';

/**
 * Schema interpreter and "hyper/media-link" agent interface.
 *
 * This type of class makes it possible to read a json-schema and load the links that are defined in it. (e.g. "follow" the links, a fetch/alter the linked resource)
 * Makes it easy to use the links defined in json-schemas as outlined in the JSON-Schema Hyper schema extension.
 */
export interface ISchemaAgent {
    /**
     * Navigable Schema used by this agent.
     */
    readonly schema: SchemaNavigator;

    /**
     * Default request headers to be sent with every request.
     */
    readonly headers: HeaderDictionary;

    /**
     * Create a new item for the currently set schema.
     *
     * @param item Values for the item to create.
     * @param urlData (Optionally) Data object to resolve parameters from the url in. If not set, uses the data/item object.
     * @param linkName The name of the link to use to create the item with.
     */
    create<T>(item: T, urlData?: IdentityValues, linkName?: string): Promise<IdentityValue>;

    /**
     * Read an item of the currently set schema.
     *
     * @param identity The identity of the entity item to read/fetch.
     * @param linkName The name of the link to use to read the item with.
     *
     * @return An promise that resolves into the requested entity, and adheres to the set link schema, if it is set.
     */
    read<T>(identity: EntityIdentity, linkName?: string): Promise<T>;

    /**
     * Read an item of the currently set schema.
     *
     * @param identity The identity-value(s) of the entity item to read/fetch, will be used to find variable-ref values in the url.
     * @param linkName The name of the link to use to read the item with.
     *
     * @return An promise that resolves into the requested entity, and adheres to the set link schema, if it is set.
     */
    read<T>(identity: EntityIdentity, linkName?: string): Promise<T>;

    /**
     * Get a cursor for this collection (if the schema supports this) and filter it's contents.
     *
     * @param filters Filter collection
     * @param sorters
     */
    filter<T>(filters: CollectionFilterDescriptor[], sorters: CollectionSortDescriptor[]): Promise<ICursor<T>>;

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
    list<T>(page?: number, limit?: number, linkName?: string, urlData?: IdentityValues): Promise<ICursor<T>>;

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
     *
     * @return A promise that resolves when the update was succesfull.
     */
    update(identity: EntityIdentity, ops: JsonPatchOperation[], linkName?: string): Promise<void>;
    update<T extends { }>(identity: EntityIdentity, item: T, linkName?: string): Promise<void>;

    /**
     * Remove an entity item.
     *
     * @param identity The id of the item to delete.
     * @param linkName The name of the link to load.
     *
     * @return A promise that resolves once the item is succesfully deleted.
     */
    delete(identity: EntityIdentity, linkName?: string): Promise<void>;

    /**
     * Execute the given link definition in the context of the current schema.
     *
     * @param link The hyper(media)link to execute/fetch.
     * @param data (Optionally) The data to send with the request (if the request is an post for example, send as post data, otherwise as query parameters, ...).
     * @param urlData (Optionally) Data object to resolve parameters from the url in. If not set, uses the data object, if that's not set it rejects.
     *
     * @return An promise resolving into the decoded response from the server/service/remote.
     */
    execute<TRequest, TResponse>(link: SchemaHyperlinkDescriptor, data?: TRequest, urlData?: IdentityValues, headers?: HeaderDictionary): Promise<SchemaAgentResponse<TResponse>>;
}

/**
 * Object that is returned as representation for what the server responded.
 */
export interface SchemaAgentResponse<T> {
    /**
     * The http-like response code as returned by the remote service.
     *
     * If undefined 200 may be assumed.
     */
    code?: number;

    /**
     * Headers or other meta information send with the request, which was not part of the body.
     */
    headers: HeaderDictionary;

    /**
     * The response body.
     */
    body: T;
}

/**
 * Object that is returned as representation by a rejected response. (In the promise catch condition)
 */
export interface SchemaAgentRejection {
    /**
     * The http-like error code as returned by the remote service.
     */
    code: number;

    /**
     * The error message token as returned by the server.
     *
     * Must be an a token that uniquely identifies the type of error that occurs.
     * Must only contain uppercase alphabetic characters and underscores.
     */
    token: string;

    /**
     * Headers or other meta information send with the request, which was not part of the body.
     */
    headers: HeaderDictionary;

    /**
     * Miscellaneous error data to further identify the error with. (Can also be the entire body of the request)
     */
    data: any;
}

export type HeaderDictionary = { [header: string]: string };
