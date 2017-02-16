import { ICursor } from './cursor';

/**
 * Cursor that is searchable by general search term. (No specific field, property or column filter)
 */
export interface ISearchableCursor<T> extends ICursor<T> {
    /**
     * Whether or not the last changes to the  have already been applied.
     */
    isSearchApplied: boolean;

    /**
     * Search terms.
     */
    readonly terms: string;

    /**
     * Used to execute a page request with an active search filter.
     *
     * To apply this filter and any other filters you have applied, call select(1).
     */
    search(terms: string): this;
}
