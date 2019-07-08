import { EventEmitter } from 'eventemitter3';
import { ISortableCursor, CollectionSortDescriptor } from './sortable-cursor';
import { IFilterableCursor, CollectionFilterDescriptor } from './filterable-cursor';
import { filterCollectionBy, sortCollectionBy } from './value-cursor';
import { ICursor, CursorLoadingState, PageChangeEvent } from './cursor';
import { SchemaNavigator } from '../navigator/schema-navigator';

import * as _ from 'lodash';
import * as debuglib from 'debug';
import { IMaskableCursor } from './maskable-cursor';
import { pointerInclusionMask } from '../helpers/json-pointer';
const debug = debuglib('schema:cursor:streaming');

const maxBufferedItems = 2000;

/**
 * Streaming filterable cursor.
 *
 * This cursor can wrap an ordinary ICursor and stream results in until it has another page that matches.
 *
 * This cursor does not support sorting, as that requires buffering the entire parent cursor resource, which would take
 * too much memory.
 *
 * When starting this cursor at page 5 it will stream all pages preceding that page in order to build a reliable page-
 * map. This also applies if you change the filters on page 5 for example, as that requires rebuilding the pagemap.
 */
export class StreamingCursor<T> extends EventEmitter implements IFilterableCursor<T>, ISortableCursor<T>, IMaskableCursor<T> {
    /**
     * Map of our page numbers, to the ranges in the parent cursor.
     */
    private pageMap: PageMapItem[] = [];

    /**
     * Whether or not the parent cursor implements IFilterableCursor.
     */
    public isParentFilterable: boolean = false;

    /**
     * Whether or not the parent cursor implements ISortableCursor.
     */
    public isParentSortable: boolean = false;

    /**
     * Whether or not the parent cursor implements IMaskableCursor.
     */
    public isParentMaskable: boolean = false;

//#region get/set limit
    public _current: number = null;

    /**
     * Limit the results per page by the given number of items.
     */
    public get current(): number {
        if (this._current === null) {
            return null;
        }
        return Math.max(this._current, 1);
    }
//#endregion

//#region get/set limit
    public _limit: number = 40;

    /**
     * Limit the results per page by the given number of items.
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

        // Apply on parent cursor
        this.parent.limit = value;
        this.clearPageMap();
    }
//#endregion

    /**
     * The total number of items in the parent resource.
     *
     * Not representative of the actual number of items in the parent if the parent cursor does not support filtering.
     */
    public get count(): number {
        return this.parent.count;
    }

    /**
     * The total number of pages.
     *
     * If the parent does not support filtering the max of this value will not exceed (this.limit * totalPages > 2000),
     * in order to prevent unresponsive node-processes and absurd memory usage.
     */
    public get totalPages(): number {
        if (!this.isParentFilterable) {
            var curmax = _.maxBy(this.pageMap, x => x.toPage);
            if (curmax) {
                if (curmax.toPage >= this.parent.totalPages) {
                    return curmax.toPage;
                }
                else {
                    return this.pageMap.indexOf(curmax) + (this.parent.totalPages - curmax.toPage);
                }
            }
            else {
                for (var i = 1; i * this.limit > maxBufferedItems; i++);
                return i;
            }
        }

        return this.parent.totalPages;
    }

    /**
     * The items of the current page.
     */
    public items: T[];

    /**
     * Get the cursor schema.
     */
    public get schema(): SchemaNavigator {
        return this.parent.schema;
    }

    /**
     * Loading state of the cursor.
     */
    public loadingState: CursorLoadingState = CursorLoadingState.Uninitialized;

    public constructor(
        private parent: ICursor<T>,
        initialPage: number | null = parent.current,
        limit?: number,
    ) {
        super();

        if (limit != null && limit >= 1) {
            this._limit = limit;
        }
        if (initialPage != null && initialPage >= 1) {
            debug(`loaded initial page ${initialPage} from constructor-override`);
            this.select(initialPage);
        }
        else if(this.parent.current != null) {
            debug(`loaded initial page ${parent.current} from parent`);
            this.select(parent.current);
        }

        var cur = this.parent as (IFilterableCursor<T> & ISortableCursor<T> & IMaskableCursor<T>);
        this.isParentFilterable = (!!cur.filters && !!cur.filterBy && !!cur.clearFilter && !!cur.clearFilters);
        this.isParentSortable = (!!cur.sorters && !!cur.sortBy && !!cur.clearSort && !!cur.clearSorters);
        this.isParentMaskable = ((cur.isMaskApplied === true || cur.isMaskApplied === false) && cur.mask !== void 0);
    }

    /**
     * Has a previous page.
     */
    public hasPrevious(): boolean {
        return (this.current > 1);
    }

    /**
     * Has a next page in the cursor.
     */
    public hasNext(): boolean {
        return (this.current < this.totalPages);
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
     * Select.
     *
     * @param page
     * @param forceReload
     */
    public select(page: number, forceReload?: boolean): Promise<T[]> {
        // Check pagenumber validity
        if (!_.isInteger(page) || page < 1) {
            const err = new Error('Pagenumber has to be an integer of 1 or higher.');
            this.emit('error', err);
            return Promise.reject(err);
        }
        if (this._current !== null && this.pageMap.length > 0 && page === this.current && !forceReload) {
            return Promise.resolve(this.items);
        }

        // Check if there is a page by this number.
        if (page > this.totalPages && this.loadingState !== CursorLoadingState.Uninitialized) {
            const err = new Error('Pagenumber is higher than the amount of pages in this cursor.');
            this.emit('error', err);
            return Promise.reject(err);
        }

        // Emit current state
        this.emit('beforePageChange', { page, items: null } as PageChangeEvent<T>);

        // Get the page if the mapping is already known
        var items: Promise<any[]>;
        if (this.pageMap.length >= page || page === 1) {
            items = this.fetch(page - 1);
        }
        else {
            items = _
                .range(this.pageMap.length - 1, page) // end is not included in the range, so this stops at page-1, which is exactly what we want
                .reduce((prev, i) => prev.then(() => this.fetch(i)), Promise.resolve([]));
        }

        return items
            .then(items => {
                this._current = page;
                if (!this.isParentMaskable && this._mask.length > 0) {
                    this.items = items.map(x => pointerInclusionMask(x, this._mask));
                }
                else {
                    this.items = items;
                }

                if (this.parent.count > 0) {
                    this.loadingState = CursorLoadingState.Ready;
                }
                else {
                    this.loadingState = CursorLoadingState.Empty;
                }

                // Emit after page change.
                this.emit('afterPageChange', { page: this._current, items: this.items } as PageChangeEvent<T>);

                return this.items;
            })
            .catch(err => {
                this.loadingState = CursorLoadingState.Error;
                this.emit('error', err);
                throw err;
            });
    }

    /**
     * Fetches a page from the parent page using the client side page index, filters it, and updates the page map.
     */
    private fetch(index: number): Promise<T[]> {
        // Check if we already mapped this
        if (this.pageMap[index]) {
            var map = this.pageMap[index];
            return Promise
                .all(
                    _.range(map.fromPage, map.toPage)
                     .map(x => this.parent.select(x)))
                .then(parentPages => {
                    if (parentPages.length === 1) {
                        return parentPages[0].slice(map.fromIndex, map.toIndex);
                    }

                    var result: any[] = [];
                    if (parentPages[0]) {
                        result = result.concat(parentPages[0].slice(map.fromIndex));
                    }
                    if (parentPages.length > 2) {
                        for (var i = 1; i < parentPages.length - 1; i++) {
                            result = result.concat(parentPages[i]);
                        }
                    }
                    if (parentPages.length > 1) {
                        result = result.concat(parentPages[parentPages.length - 1].slice(0, map.toIndex));
                    }

                    return filterCollectionBy(result, this.filters);
                });
        }

        var startPage: number,
            startIndex: number;
        if (this.pageMap.length === 0) {
            startPage = 1;
            startIndex = 0;
        }
        else if (this.pageMap[index - 1]) {
            startPage = this.pageMap[index - 1].toPage;
            startIndex = this.pageMap[index - 1].toIndex;
        }
        else {
            throw new Error('This scenario should\'ve been handled by the select() method');
        }

        if (startIndex >= this.limit - 1) {
            startPage++;
            startIndex = 0;
        }

        var getPageIndex = (results: any[], currentPage: number, currentIndex?: number): Promise<any[]> => {
            return this.parent.select(currentPage).then(items => {
                // We already passed the end of the stream! Probably incorrectly implemented wrapped cursor.
                if (items.length === 0) {
                    debug('[warn] we have not reached totalPages, but did receive empty page! incorrectly implemented parent cursor?');
                    this.pageMap[index] = {
                        fromPage: startPage,
                        fromIndex: startIndex,
                        toPage: Math.max(startPage, currentPage - 1),
                        toIndex: this.limit
                    };
                    return results;
                }

                if (currentIndex) {
                    items = items.slice(currentIndex);
                }

                var filteredItems = filterCollectionBy(items, this._filters);
                // IF we have reached all the items we need to load the current page, stop.
                // OR we have reached the last page of the parent cursor.
                if (results.length + filteredItems.length >= this.limit || currentPage >= this.totalPages) {
                    this.pageMap[index] = {
                        fromPage: startPage,
                        fromIndex: startIndex,
                        toPage: currentPage,
                        // toIndex: (results.length + filteredItems.length) - this.limit - 1,
                        toIndex: Math.max(Math.min(items.length, this.limit), 0),
                    }
                    return results.concat(filteredItems.slice(0, this.pageMap[index].toIndex));
                }

                var intermediaryResults = results.concat(filteredItems);
                return getPageIndex(intermediaryResults, currentPage + 1).catch(err => {
                    // Probably an out-of-bounds error, ignore and return what we have.
                    debug(`when trying to get more results than we currently had, we got an error:`, err);
                    return intermediaryResults;
                });
            });
        }

        return getPageIndex([], startPage, startIndex);
    }

    /**
     * Filters
     * @param limit
     */
    public all(limit?: number): Promise<T[]> {
        return this.parent.all(Math.min(limit, maxBufferedItems)).then(items => {
            if (!this.isParentFilterable) {
                items = filterCollectionBy(items, this._filters);
            }
            if (!this.isParentSortable) {
                items = sortCollectionBy(items, this._sorters)
            }
            return items;
        });
    }

    //#region IMaskableCursor implementation
        public isMaskApplied: boolean = true;

        //#region get/set mask
            private _mask: string[] = [];

            /**
             * A list of JSON-Pointers that describe what fields should be included in the response, in order to reduce response data size. (Could ignored by agent)
             */
            public get mask(): string[] {
                if (this.isParentMaskable) {
                    return (this.parent as IMaskableCursor<T>).mask;
                }
                return this._mask;
            }
            public set mask(mask: string[]) {
                if (!Array.isArray(mask) || mask == null) {
                    mask = [];
                }
                else if (this._mask.length === mask.length && mask.every(x => this._mask.indexOf(x) >= 0)) {
                    return;
                }

                if (this.isParentMaskable) {
                    (this.parent as IMaskableCursor<T>).mask = mask;
                }
                else {
                    this._mask = mask;
                }
                this.isMaskApplied = false;
            }
        //#endregion
    //#endregion

    //#region IFilterableCursor implementation
        public areFiltersApplied: boolean = true;

        //#region get/set filters
            private _filters: CollectionFilterDescriptor[] = [];

            /**
             * Filters set on this cursor/collection that limit the items in this cursor.
             */
            public get filters(): CollectionFilterDescriptor[] {
                return this._filters;
            }
        //#endregion

        /**
         * Filters the cursor's collection by the given filter(s) and applies them, and reload the current page.
         *
         * @param filter The (additional) filter(s) to filter the collection with.
         * @param replace Whether or not the given filter(s) should replace the currently set filters.
         *
         * @return A promise resolving into all the items on the current page in the filtered collection.
         */
        public filterBy(filter: CollectionFilterDescriptor | CollectionFilterDescriptor[], replace: boolean = false): this {
            this.areFiltersApplied = false;

            if (replace === true) {
                this._filters = _.isArray(filter) ? filter : [filter];
                return this;
            }

            if (_.isArray(filter)) {
                this._filters.push(...filter);
            }
            else {
                this._filters.push(filter);
            }

            return this;
        }

        /**
         * Clear the specified filter from the filter-list, and reload the current page.
         *
         * @param filter The filter(s) to filter the collection with.
         *
         * @return A promise resolving into all the items on the current page in the filtered collection.
         */
        public clearFilter(filter: CollectionFilterDescriptor | CollectionFilterDescriptor[]): this {
            let filters = _.isArray(filter) ? filter : [filter];
            this._filters = _.filter(this._filters, x => !_.includes(filters, x));
            return this;
        }

        /**
         * Clear all currently set filters, and reload the current page.
         *
         * @return A promise resolving into a list of all items on the current page without any filters set.
         */
        public clearFilters(): this {
            if (this._filters.length > 0) {
                this._filters = [];
                this.areFiltersApplied = false;
            }
            return this;
        }
    //#endregion

    //#region ISortableCursor implementation
        /**
         * Whether or not the last changes to the set sorters have already been applied.
         */
        public areSortersApplied: boolean = true;

        //#region get/set sorters
            private _sorters: CollectionSortDescriptor[] = [];

            /**
             * Descriptors for how to sort this cursor.
             */
            public get sorters(): CollectionSortDescriptor[] {
                return this._sorters.slice();
            }
        //#endregion

        /**
         * Sorts the cursor's collection by the given sortable(s), applies them and reloads the current page.
         *
         * @param sort The (additional) sort(ers) to sort the collection with.
         * @param replace Whether or not the given sort(ers) should replace the currently set sorters.
         *
         * @return A promise resolving into all the items on the current page in the sorted collection.
         */
        public sortBy(sort: CollectionSortDescriptor | CollectionSortDescriptor[], replace: boolean = false): this {
            this.areSortersApplied = false;

            if (replace === true) {
                this._sorters = _.isArray(sort) ? sort : [sort];
                return this;
            }

            if (_.isArray(sort)) {
                _.each(sort, x => this.sortBy(x, false));
                return this;
            }

            let prev: number = _.findIndex(this._sorters, x => x.path === sort.path);
            if (prev >= 0) {
                this._sorters.splice(prev, 1, sort);
            }
            else {
                this._sorters.push(sort);
            }

            return this;
        }

        /**
         * Clear the specified sortable from the sort-list, and reload the current page.
         *
         * @param sort The sorter(s) to sort the collection with.
         *
         * @return A promise resolving into all the items on the current page in the (un)sorted collection.
         */
        public clearSort(sort: CollectionSortDescriptor | CollectionSortDescriptor[]): this {
            let sorters = _.isArray(sort) ? sort : [sort];
            this._sorters = _.filter(this._sorters, x => !_.includes(sorters, x));
            return this;
        }

        /**
         * Clear all currently set sorters, and reload the current page.
         *
         * @return A promise resolving into a list of all items on the current page without any sorters set.
         */
        public clearSorters(): this {
            if (this._sorters.length > 0) {
                this._sorters = [];
                this.areSortersApplied = false;
            }
            return this;
        }
    //#endregion

    /**
     * Reset the pagemap because a critical property is changed.
     */
    private clearPageMap(): void {
        this.pageMap = [];
    }
}

interface PageMapItem {
    fromPage: number;
    fromIndex: number;
    toPage: number;
    toIndex: number;
}
