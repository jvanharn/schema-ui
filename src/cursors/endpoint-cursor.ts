import { ICursor, CursorLoadingState, PageChangeEvent, getAllCursorPages } from './cursor';
import { ISearchableCursor } from './searchable-cursor';

import { SchemaNavigator } from '../navigator/schema-navigator';

import { SchemaHyperlinkDescriptor, IdentityValues } from '../models/index';

import { ISchemaAgent, SchemaAgentResponse } from '../agents/schema-agent';
import { EndpointSchemaAgent } from '../agents/endpoint-schema-agent';

import { EventEmitter } from 'eventemitter3';
import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:cursor:endpoint');

/**
 * Cursor that can traverse standardized endpoints.
 *
 * In order to be able to traverse an endpoint of this type, the endpoint needs to support:
 */
export class EndpointCursor<T> extends EventEmitter implements ICursor<T>, ISearchableCursor<T> {
    /**
     * The default name for a search term.
     */
    public static globalSearchTermProperty: string = 'search';

    /**
     * Search term property name. (Where to place generic search terms.)
     */
    public searchTermProperty: string = EndpointCursor.globalSearchTermProperty;

    /**
     * Get the schema.
     */
    public get schema(): SchemaNavigator {
        return this.agent.schema;
    }

    //region get/set limit
        private _limit: number = 40;

        /**
         * The limit of the items on a page.
         *
         * Also called "Items per Page", "Page Count", ...
         */
        public get limit(): number {
            return this._limit;
        }
        public set limit(value: number) {
            if (!_.isInteger(value) || value < 1) {
                debug('[warn] Invalid value given for the limit value.');
                return;
            }
            this._limit = value;
            if (!!this.autoReload) {
                this.select(this.current);
            }
        }
    //endregion

    //region get/set current
        private _current: number = null;

        /**
         * The page that the items collection currently reflects in the datasource.
         */
        public get current(): number {
            return Math.max(this._current, 1);
        }
        public set current(value: number) {
            if (!_.isInteger(value) || value < 1) {
                debug('[warn] Invalid value given for the current value.');
                return;
            }
            if (!!this.autoReload) {
                this.select(value);
            }
            else {
                debug('[warn] Setting the current page does not work when EndpointCursor.autoReload is set to false!');
            }
        }
    //endregion

    //region get/set count
        public _count: number = 0;

        /**
         * Total number of items in the datasource.
         */
        public get count(): number {
            return this._count;
        }
    //endregion

    //region get/set totalPages
        public _totalPages: number = 1;

        /**
         * Total number of pages in the datasource.
         */
        public get totalPages(): number {
            return this._totalPages;
        }
    //endregion

    //region get/set items
        public _items: T[] = [];

        /**
         * Items in the current page.
         */
        public get items(): T[] {
            return this._items;
        }
    //endregion

    /**
     * Parameter is used to indicate that the cursor is loading.
     * @default CursorLoadingState.Uninitialized
     */
    public loadingState: CursorLoadingState = CursorLoadingState.Uninitialized;

    /**
     * Whether or not to automatically reload the page when the page limit or other property is changed.
     */
    public autoReload: boolean = false;

    /**
     * @param agent The agent to make the requests with.
     * @param linkName The link
     * @param initialPage The initial page to load. If set to NULL, will not load an initial page, and will wait for a call to filter(), next(), ...
     * @param limit The maximum amount of items per page.
     */
    public constructor(
        private readonly agent: ISchemaAgent,
        private readonly linkName: string,
        initialPage: number | null,
        limit?: number,
        private readonly urlData?: IdentityValues,
        private paginationInfoExtractor: PaginationInfoExtractorFunc = genericPaginationInfoExtractor,
        private paginationRequestGenerator: PaginationRequestGeneratorFunc = genericPaginationRequestGenerator
    ) {
        super();
        if (limit != null && limit >= 1) {
            this._limit = limit;
        }
        if (initialPage != null && initialPage >= 1) {
            debug(`loaded initial page ${initialPage} for [${this.agent.schema.root.id}]->{${this.linkName}}`);
            this.select(initialPage);
        }
    }

//region Page changing
    /**
     * Whether there's a page before the current one.
     */
    public hasPrevious(): boolean {
        return this.current > 1;
    }

    /**
     * Whether there's a page after the current one.
     */
    public hasNext(): boolean {
        return this.current < this.totalPages;
    }

    /**
     * Used to navigate to the next page.
     *
     * @return A promise resolving in the page's items.
     */
    public next(): Promise<T[]> {
        if (!this.hasNext()) {
            return Promise.reject('This the last page!');
        }
        return this.select(this.current + 1);
    }

    /**
     * Used to navigate to the previous page.
     *
     * @return A promise resolving in the page's items.
     */
    public previous(): Promise<T[]> {
        if (!this.hasPrevious()) {
            return Promise.reject('This the first page!');
        }
        return this.select(this.current - 1);
    }

    /**
     * Reloads the currently loaded page.
     *
     * @return A promise resolving in the items on the current page.
     */
    public refresh(): Promise<T[]> {
        return this.select(this.current, true);
    }

    /**
     * Select a page by number.EndpointSchemaAgent
     *
     * @param page The 1-indexed page to navigate to.
     * @param forceReload Whether or not to force a reload of the age, even if we are already on the given page.
     *
     * @return A promise resolving in the page's items.
     */
    public select(page: number, forceReload: boolean = false): Promise<T[]> {
        // Check pagenumber validity
        if (!_.isInteger(page) || page < 1) {
            return Promise.reject(new Error('Pagenumber has to be an integer of 1 or higher.'));
        }
        if (this._current !== null && page === this._current && !forceReload) {
            return Promise.resolve(this.items);
        }

        // Get the correct link
        let link: SchemaHyperlinkDescriptor;
        if (_.isString(this.linkName)) {
            link = this.agent.schema.getLink(this.linkName);
        }
        else {
            link = this.agent.schema.getFirstLink([
                'list',       // The name this library propagates.
                'collection', // Defined in the Item and Collection rfc6573
                'index'
            ]);
        }
        if (!link) {
            return Promise.reject(new Error('Unable to find a link for this cursor to fetch any pages.'));
        }

        // Create urlData object from absolutely all data we can possibly find.
        let urlData = this.paginationRequestGenerator(this, page, this.limit);
        if (!_.isEmpty(this.terms)) {
            urlData[this.searchTermProperty] = this.terms;
        }

        // Emit event before the fetch
        this.loadingState = CursorLoadingState.Loading;
        this.emit('beforePageChange', { page: page, items: null });

        // Execute the request.
        return new Promise<T[]>((resolve, reject) => {
            this.agent
                .execute<void, any>(link, void 0, urlData)
                .then(response => {
                    this._current = page;

                    // Extract the request data
                    let info = this.paginationInfoExtractor<T>(this, response);
                    this._items = info.items || [];
                    this._totalPages = info.totalPages;
                    this._count = info.count;

                    // Some sanity checks
                    if (this.items.length > this.limit) {
                        debug(`[warn] The amount of items returned (${this.items.length}) by the agent/server/service was higher than the amount of requested items (${this.limit})!`);
                    }

                    // Emit event after the succesfull fetch
                    this.loadingState = this._items.length > 0 ? CursorLoadingState.Ready : CursorLoadingState.Empty;
                    this.emit('afterPageChange', { page: this.current, items: this.items });

                    // Set the X-applied properties
                    this.isSearchApplied = true;

                    resolve(info.items);
                })
                .catch(err => {
                    debug(`error ocurred whilst trying to fetch page (${page}/${this.totalPages}) limit: ${this.limit} of [${this.agent.schema.root.id}].`);
                    this.emit('error', err);
                    reject(err);
                });
        });
    }
//endregion

    /**
     * Get all the items inside the collection as a promised list.
     *
     * As some collections may contain millions of items, please *always* check the total count of the collection first.
     *
     * @param limit The maximum amount of items per page to use during the fetching of all pages.
     *
     * @return A promise resolving in all the items in this collection (Beware, this can pottentially be millions of items).
     */
    public all(limit?: number): Promise<T[]> {
        return getAllCursorPages(this);
    }

//region ISearchableCursor implementation
    public _terms: string;

    /**
     * Currently active search terms.
     */
    public get terms(): string {
        return this._terms;
    }

    /**
     * Used to execute a page request with an active search filter.
     */
    public search(terms: string): this {
        this._terms = terms;
        this.isSearchApplied = false;
        return this;
    }

    /**
     * Whether or not the search terms were applied.
     */
    public isSearchApplied: boolean = true;
//endregion
}

/**
 * Interface defining the properties that should be extracted from a pagination response.
 */
export interface PaginationInfo<T> {
    /**
     * The items that came in the response.
     */
    items: T[];

    /**
     * Total number of pages in the resource.
     */
    totalPages: number;

    /**
     * Total number of items in the collection.
     */
    count: number;
}

/**
 * Function that can extract the needed info for the cursor to load the given response as the current page.
 */
export type PaginationInfoExtractorFunc = <T>(cursor: EndpointCursor<T>, response: SchemaAgentResponse<any>) => PaginationInfo<T>;

/**
 * Function that can create a dictionary of identity values.
 */
export type PaginationRequestGeneratorFunc = <T>(cursor: EndpointCursor<T>, page: number, limit: number) => IdentityValues;

/**
 * Generic method for fetching pagination information from an agent response.
 */
export function genericPaginationInfoExtractor<T>(cursor: EndpointCursor<T>, response: SchemaAgentResponse<any>): PaginationInfo<T> {
    // Check the body
    let result: Partial<PaginationInfo<T>> = genericPaginationInfoKeyExtractor<T>({}, response.body);

    // Check the headers.
    if (!_.isEmpty(response.headers)) {
        result = genericPaginationInfoKeyExtractor(result, response.headers);
    }

    // Check the body sub-keys
    let usable = _.findKey(response.body, (v, k) => _.includes(paginationMetaKeys, k.toLowerCase()));
    if (!!usable) {
        result = genericPaginationInfoKeyExtractor(result, response.body[usable]);
    }

    // Return whatever we have
    return result as PaginationInfo<T>;
}

/**
 * Helper method that will check for all needed properties in the given object.
 */
function genericPaginationInfoKeyExtractor<T>(partial: Partial<PaginationInfo<T>>, data: any): Partial<PaginationInfo<T>> {
    // Try to set the item count.
    for (let key of paginationCollectionCountProperties) {
        if (_.isFinite(partial.count)) {
            break;
        }
        partial.count = checkDataKey<number>(_.isFinite, data, key);
    }

    // Try to set the page count.
    for (let key of paginationPageCountProperties) {
        if (_.isFinite(partial.totalPages)) {
            break;
        }
        partial.totalPages = checkDataKey<number>(_.isFinite, data, key);
    }

    // Try to set the items array.
    for (let key of paginationPageItemsProperties) {
        if (_.isFinite(partial.items)) {
            break;
        }
        partial.items = checkDataKey<T[]>(_.isArray, data, key);
    }

    return partial;
}

/**
 * Takes a validator, data and a key to check on, and checks it's presence in various formats and whether the value of that key is acceptable.
 */
function checkDataKey<T>(validator: (item: any) => boolean, data: any, key: string): T | null {
    for (let testable of [key, _.snakeCase(key), _.kebabCase(key)]) {
        if (data[key] != null && validator(data[key])) {
            return data[key];
        }
    }
    return null;
}

/**
 * Generic method for generating urlData for an agent request.
 */
export function genericPaginationRequestGenerator<T>(cursor: EndpointCursor<T>, page: number, limit: number): IdentityValues {
    let urlData: IdentityValues = { };

    // Set the possible variations of the page keyword.
    for (let key of paginationPageProperties) {
        urlData[key] = page;
        urlData[_.snakeCase(key)] = page;
        urlData[_.kebabCase(key)] = page;
    }

    // Set the possible variations of the limit keyword.
    for (let key of paginationPageLimitProperties) {
        urlData[key] = limit;
        urlData[_.snakeCase(key)] = limit;
        urlData[_.kebabCase(key)] = limit;
    }

    return urlData;
}

/**
 * Properties that commonly identify the amount of items that should be displayed per page.
 */
const paginationPageLimitProperties = [
    'limit',
    'perPage'
];

/**
 * Properties that commonly identify the currently loaded page.
 */
const paginationPageProperties = [
    'index',
    'page',
    'pageNumber'
];

/**
 * Properties that commonly identify an property or header that contains the total number of items in the collection.
 */
const paginationPageCountProperties = [
    'pages',
    'numPages',
    'length',
    'size'
];

/**
 * Properties that commonly identify an property or header that contains the total number of items in the collection.
 */
const paginationCollectionCountProperties = [
    'totalCount',
    'itemCount'
];

/**
 * Properties that commonly identify an property or header that contains the total number of items in the collection.
 */
const paginationPageItemsProperties = [
    'items',
    'data',
    'collection'
];

/**
 * If the keywords needed for extracting info isnt in the root of the response, look in these objects.
 */
const paginationMetaKeys = [
    'pagination',
    'meta'
];
