import { ICursor } from './cursor';

/**
 * Cursor that can be sorted using sort descriptors.
 */
export interface ISortableCursor<T> extends ICursor<T> {
    /**
     * Whether or not the last changes to the set sorters have already been applied.
     */
    areSortersApplied: boolean;

    /**
     * Sorters set on this cursor/collection that alter the ordering of the contained items.
     */
    readonly sorters: CollectionSortDescriptor[];

    /**
     * Sorts the cursor's collection by the given sortable(s), applies them and reloads the current page.
     *
     * @param sort The (additional) sort(ers) to sort the collection with.
     * @param replace Whether or not the given sort(ers) should replace the currently set sorters. Defaults to replacing.
     *
     * @return A promise resolving into all the items on the current page in the sorted collection.
     */
    sortBy(sort: CollectionSortDescriptor | CollectionSortDescriptor[], replace?: boolean): this;

    /**
     * Clear the specified sortable from the sort-list, and reload the current page.
     *
     * @param sort The sorter(s) to sort the collection with.
     *
     * @return A promise resolving into all the items on the current page in the (un)sorted collection.
     */
    clearSort(sort: CollectionSortDescriptor | CollectionSortDescriptor[]): this;

    /**
     * Clear all currently set sorters, and reload the current page.
     *
     * @return A promise resolving into a list of all items on the current page without any sorters set.
     */
    clearSorters(): this;
}

/**
 * Enumerated list of available sorting modes. used to determine what mode to set when a column is clicked.
 */
export enum SortingDirection {
    /**
     * Sort in the ascending direction.
     */
    Ascending,

    /**
     * Sort in the descending direction.
     */
    Descending
}

/**
 * Describes a sorter for on a collection.
 */
export interface CollectionSortDescriptor {
    /**
     * JSON Pointer that points to the item to be sorted by.
     */
    path: string;

    /**
     * Sorting direction to apply.
     */
    direction: SortingDirection;
}

/**
 * Inverses the given sorting mode.
 *
 * @return The inverse of the given sorting mode.
 */
export function inverseSortMode(mode: SortingDirection): SortingDirection {
    // @warn Do not make this equiation exact type checking (===)
    if (mode == SortingDirection.Ascending) {
        return SortingDirection.Descending;
    }
    else if (mode == SortingDirection.Descending) {
        return SortingDirection.Ascending;
    }
    return SortingDirection.Ascending;
}
