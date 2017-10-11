import { CursorLoadingState, PageChangeEvent, getAllCursorPages } from './cursor';
import { CollectionFilterDescriptor, CollectionFilterOperator } from './filterable-cursor';
import { CollectionSortDescriptor, SortingDirection, inverseSortMode } from './sortable-cursor';
import { IColumnizedCursor } from './columnized-cursor';
import { SchemaColumnDescriptor } from '../models/table';
import { ISearchableCursor } from './searchable-cursor';
import { SchemaNavigator } from '../navigator/schema-navigator';

import { EventEmitter } from 'eventemitter3';
import * as pointer from 'json-pointer';
import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:cursor:value');

/**
 * Cursor that can iterate over a source array.
 */
export class ValueCursor<T> extends EventEmitter implements IColumnizedCursor<T>, ISearchableCursor<T> {
    //region get/set limit
        protected _limit: number = 40;

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
        protected _current: number = null;

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

    //region get/set search
        /**
         * Currently active search terms.
         */
        public get terms(): string {
            return this._terms;
        }
        protected _terms: string;
    //endregion

    //region get/set columns
        /**
         * Set and get the columns for the cursor and set primaries
         */
        public get columns(): SchemaColumnDescriptor[] {
            if (this._columns == null) {
                return this.schema.columns;
            }
            return this._columns;
        }
        public set columns(value: SchemaColumnDescriptor[]) {
            if (!_.isArray(value)) {
                throw new Error('Expected array');
            }
            this._columns = value.slice();
        }
        public _columns: SchemaColumnDescriptor[];
    //endregion

    //region get/set filters
        /**
         * Filters set on this cursor/collection that limit the items in this cursor.
         */
        public get filters(): CollectionFilterDescriptor[] {
            return this._filters;
        }
        protected _filters: CollectionFilterDescriptor[] = [];
    //endregion

    //region get/set sorters
        /**
         * Sorters set on this cursor/collection that alter the ordering of the contained items.
         */
        public get sorters(): CollectionSortDescriptor[] {
            return this._sorters;
        }
        protected _sorters: CollectionSortDescriptor[] = [];
    //endregion

    /**
     * Parameter is used to indicate that the cursor is loading.
     * @default CursorLoadingState.Uninitialized
     */
    public loadingState: CursorLoadingState = CursorLoadingState.Uninitialized;

    /**
     * Whether or not the search terms were applied.
     */
    public isSearchApplied: boolean = true;

    /**
     * Whether or not the last changes to the set filters have already been applied.
     */
    public areFiltersApplied: boolean = true;

    /**
     * Whether or not the last changes to the set sorters have already been applied.
     */
    public areSortersApplied: boolean = true;

    /**
     * Whether or not the last changes to the set sorters/filters on columns have already been applied.
     */
    public get areColumnsApplied(): boolean {
        return this.areFiltersApplied && this.areSortersApplied;
    }

    /**
     * Whether or not to automatically reload the page when the page limit or other property is changed.
     */
    public autoReload: boolean = false;

    /**
     * @param _wrapped The wrapped collection.
     */
    public constructor(
        public readonly schema: SchemaNavigator,
        private _wrapped: T[],
        intialPage: number | null,
        columns?: SchemaColumnDescriptor[],
    ) {
        super();
        this._count = _wrapped.length;
        if (this._wrapped.length === 0) {
            this.loadingState = CursorLoadingState.Empty;
        }
        else {
            this.loadingState = CursorLoadingState.Ready;
        }

        if (_.isArray(columns)) {
            this.columns = columns;
        }

        if (intialPage !== null) {
            this.select(intialPage || 1);
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
            return Promise.reject<any>('This the last page!');
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
            return Promise.reject<any>('This the first page!');
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
     * @inherit
     */
    public select(pageNumber: number = 1, forceReload?: boolean): Promise<T[]> {
        this._items = this._wrapped.slice();

        // Filters
        this._items = filterCollectionBy(this._items, this.filters);

        // Search
        if (this.terms != null && this.terms.trim() != '') {
            let qry = String(this.terms).toLowerCase();
            this._items = _.filter(this._items, x => {
                for (var key in x) {
                    if (x.hasOwnProperty(key) && String(x[key]).toLowerCase().indexOf(qry) >= 0) {
                        return true;
                    }
                }
                return false;
            });
        }

        // Sort
        this._items = sortCollectionBy(this._items, this.sorters);

        // Limit
        var startIndex = (pageNumber - 1) * this.limit;
        var endIndex = pageNumber * this.limit;
        this._items = _.slice(this._items, startIndex, endIndex);

        // Set cursor state
        this._current = pageNumber;
        this.loadingState = this._items.length > 0 ? CursorLoadingState.Ready : CursorLoadingState.Empty;
        this.areFiltersApplied = true;
        this.areSortersApplied = true;

        return Promise.resolve(this.items);
    }
//endregion

    /**
     * @inherit
     */
    public all(limit?: number): Promise<T[]> {
        return getAllCursorPages(this);
    }

    //region ISearchableCursor implementation
        /**
         * Used to execute a page request with an active search filter.
         */
        public search(terms: string): this {
            this._terms = terms;
            this.isSearchApplied = false;
            return this;
        }
    //endregion

    //region IFilterableCursor implementation
        /**
         * Filters the cursor's collection by the given filter(s) and applies them, and reload the current page.
         *
         * @param filter The (additional) filter(s) to filter the collection with.
         * @param replace Whether or not the given filter(s) should replace the currently set filters.
         *
         * @return A promise resolving into all the items on the current page in the filtered collection.
         */
        public filterBy(filter: CollectionFilterDescriptor | CollectionFilterDescriptor[], replace: boolean = true): this {
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
            this.areFiltersApplied = false;

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
    //endregion

    //region ISortableCursor implementation
        /**
         * Sorts the cursor's collection by the given sortable(s), applies them and reloads the current page.
         *
         * @param sort The (additional) sort(ers) to sort the collection with.
         * @param replace Whether or not the given sort(ers) should replace the currently set sorters.
         *
         * @return A promise resolving into all the items on the current page in the sorted collection.
         */
        public sortBy(sort: CollectionSortDescriptor | CollectionSortDescriptor[], replace: boolean = true): this {
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
    //endregion

    //region IColumnizedCursor implementation
        /**
         * Sort the cursor by the given column name.
         *
         * @param columnId The id of the column to sort by.
         * @param direction The direction to sort in (ascending/descending).
         *
         * @return A promise resolving in the sorted first page or rejected when the column is not sortable.
         */
        public sortByColumn(columnId: string, direction: SortingDirection): this {
            let col = _.find(this._columns, x => x.id === columnId);
            if (!col.sortable) {
                throw new Error(`Unable to sort for column "${columnId}", it says it cant be sorted on.`);
            }
            this.sortBy({
                path: !!col.path ? col.path : `/${col.id}`,
                direction
            });
            return this;
        }

        /**
         * Filter the cursor by the given column name and value.
         *
         * @param columnId The id of the column to filter on.
         * @param operator The comparison operator to apply on the column-value and the given value.
         * @param value The value to commpare with.
         *
         * @return A promise resolving in the filtered first page or rejected when the column is not filterable.
         */
        public filterByColumn(columnId: string, operator: CollectionFilterOperator, value: any): this {
            let col = _.find(this._columns, x => x.id === columnId);
            if (!col.filterable) {
                throw new Error(`Unable to filter for column "${columnId}", it says it cant be filtered on.`);
            }
            this.filterBy({
                path: !!col.path ? col.path : `/${col.id}`,
                operator,
                value
            });
            return this;
        }
    //endregion
}

/**
 * Applies CollectionSortDescriptors to a collection.
 */
export function sortCollectionBy<T>(collection: T[], sorters: CollectionSortDescriptor[]): T[] {
    return _.orderBy(
        collection,
        _.map(sorters, x => _.trimStart(x.path, '/')),
        _.map(sorters, x => ['asc', 'desc'][x.direction]));
}

/**
 * Applies CollectionFilterDescriptor to a collection.
 */
export function filterCollectionBy<T>(collection: T[], filters: CollectionFilterDescriptor[]): T[] {
    return _.filter(collection, x => _.every(filters, f => {
        if (f.path === '*') {
            return _.some(_.toPairs(x), ([k, v]) => {
                try {
                    return applyFilter({
                        path: '/' + k,
                        operator: f.operator,
                        value: f.value
                    }, v);
                } catch (e) {
                    return false;
                }
            });
        }

        try {
            return applyFilter(f, pointer.get(x, f.path))
        } catch (e) {
            return false;
        }
    }));
}

/**
 * Apply filter to value.
 */
function applyFilter(filter: CollectionFilterDescriptor, val: any): boolean {
    if (_.isString(filter.operator)) {
        filter.operator = parseInt(filter.operator, 10);
    }
    switch (filter.operator) {
        case CollectionFilterOperator.Contains:
            return String(val).toLowerCase()
                .indexOf(String(filter.value).toLowerCase()) >= 0;
        case CollectionFilterOperator.ContainsKey:
            if (!_.isObject(val)) {
                return false;
            }
            let keys = _.keys(val);
            if (_.isArray(filter.value)) {
                return _.every(filter.value, x => _.includes(keys, String(x).toLowerCase()));
            }
            return _.includes(keys, String(filter.value).toLowerCase());
        case CollectionFilterOperator.NotContains:
            return String(val).toLowerCase()
                .indexOf(String(filter.value).toLowerCase()) < 0;
        case CollectionFilterOperator.Equals:
            return String(val).toLowerCase() === String(filter.value).toLowerCase();
        case CollectionFilterOperator.NotEquals:
            return String(val).toLowerCase() !== String(filter.value).toLowerCase();
        case CollectionFilterOperator.LessThan:
            if (_.isNumber(val)) {
                return val < filter.value;
            }
            else if (_.isString(val) || _.isArray(val)) {
                return val.length < filter.value;
            }
            return false;
        case CollectionFilterOperator.LessThanOrEquals:
            if (_.isNumber(val)) {
                return val <= filter.value;
            }
            else if (_.isString(val) || _.isArray(val)) {
                return val.length <= filter.value;
            }
            return false;
        case CollectionFilterOperator.GreaterThan:
            if (_.isNumber(val)) {
                return val > filter.value;
            }
            else if (_.isString(val) || _.isArray(val)) {
                return val.length > filter.value;
            }
            return false;
        case CollectionFilterOperator.GreaterThanOrEquals:
            if (_.isNumber(val)) {
                return val >= filter.value;
            }
            else if (_.isString(val) || _.isArray(val)) {
                return val.length >= filter.value;
            }
            return false;
        case CollectionFilterOperator.In:
            if (_.isArray(filter.value)) {
                return _.includes(filter.value, val);
            }
            return String(val) === String(filter.value);
        case CollectionFilterOperator.NotIn:
            if (_.isArray(filter.value)) {
                return !_.includes(filter.value, val);
            }
            return String(val) === String(filter.value);
        default:
            debug(`[error] Got invalid Collection filter operator value "${filter.operator}"`);
    }
}
