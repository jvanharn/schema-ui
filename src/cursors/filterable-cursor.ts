import { ICursor } from './cursor';

/**
 * Cursor that can be filtered using filter descriptors.
 */
export interface IFilterableCursor<T> extends ICursor<T> {
    /**
     * Whether or not the last changes to the set filters have already been applied.
     */
    areFiltersApplied: boolean;

    /**
     * Filters set on this cursor/collection that limit the items in this cursor.
     */
    readonly filters: CollectionFilterDescriptor[];

    /**
     * Filters the cursor's collection by the given filter(s) and applies them, and reload the current page.
     *
     * @param filter The (additional) filter(s) to filter the collection with.
     * @param replace Whether or not the given filter(s) should replace the currently set filters.
     *
     * @return A promise resolving into all the items on the current page in the filtered collection.
     */
    filterBy(filter: CollectionFilterDescriptor | CollectionFilterDescriptor[], replace: boolean): this;

    /**
     * Clear the specified filter from the filter-list, and reload the current page.
     *
     * @param filter The filter(s) to filter the collection with.
     *
     * @return A promise resolving into all the items on the current page in the filtered collection.
     */
    clearFilter(filter: CollectionFilterDescriptor | CollectionFilterDescriptor[]): this;

    /**
     * Clear all currently set filters, and reload the current page.
     *
     * @return A promise resolving into a list of all items on the current page without any filters set.
     */
    clearFilters(): this;
}

/**
 * Operator to applied as a filter.
 */
export enum CollectionFilterOperator {
    Equals,
    GreaterThanOrEquals,
    LessThanOrEquals,

    LessThan,
    GreaterThan,

    In,

    NotEquals,
    NotIn,

    Contains,
    NotContains,
}

/**
 * Describes a filter for on a collection.
 */
export interface CollectionFilterDescriptor {
    /**
     * JSON Pointer that points to the item to be filtered.
     */
    path: string;

    /**
     * Operator to apply on the item value and the given filter value.
     */
    operator: CollectionFilterOperator;

    /**
     * Value of the filter.
     */
    value: any;
}
