import { ICursor } from './cursor';
import { IFilterableCursor, CollectionFilterOperator } from './filterable-cursor';
import { ISortableCursor, SortingDirection } from './sortable-cursor';
import { SchemaColumnDescriptor }from '../models/table';

/**
 * Cursor that supports having columns (like when using them for JsonTableSchema resources).
 */
export interface IColumnizedCursor<T> extends ISortableCursor<T>, IFilterableCursor<T> {
    /**
     * Whether or not the last changes to the set sorters/filters on columns have already been applied.
     */
    areColumnsApplied: boolean;

    /**
     * List of columns in the cursor.
     */
    columns: SchemaColumnDescriptor[];

    /**
     * Sort the cursor by the given column name.
     *
     * @param columnId The id of the column to sort by.
     * @param direction The direction to sort in (ascending/descending).
     *
     * @return A promise resolving in the sorted first page or rejected when the column is not sortable.
     */
    sortByColumn(columnId: string, direction: SortingDirection): this;

    /**
     * Filter the cursor by the given column name and value.
     *
     * @param columnId The id of the column to filter on.
     * @param operator The comparison operator to apply on the column-value and the given value.
     * @param value The value to commpare with.
     *
     * @return A promise resolving in the filtered first page or rejected when the column is not filterable.
     */
    filterByColumn(columnId: string, operator: CollectionFilterOperator, value: any): this;
}
