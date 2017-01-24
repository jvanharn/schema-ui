import { ICursor } from './cursor';
import { IFilterableCursor, CollectionFilterOperator } from './filterable-cursor';
import { ISortableCursor, SortingDirection } from './sortable-cursor';

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
    columns: CursorColumnDefinition[];

    /**
     * Sort the cursor by the given column name.
     *
     * @param columnName The name of the column to sort by.
     * @param direction The direction to sort in (ascending/descending).
     *
     * @return A promise resolving in the sorted first page or rejected when the column is not sortable.
     */
    sortByColumn(columnName: string, direction: SortingDirection): this;

    /**
     * Filter the cursor by the given column name and value.
     *
     * @param columnName The name of the column to filter on.
     * @param operator The comparison operator to apply on the column-value and the given value.
     * @param value The value to commpare with.
     *
     * @return A promise resolving in the filtered first page or rejected when the column is not filterable.
     */
    filterByColumn(columnName: string, operator: CollectionFilterOperator, value: any): this;
}

/**
 * Interface that defines the minimum amount of information required by the cursor in a column definition.
 *
 * Any extra functionality (like how the column should be displayed) should be defined in implementations of this interface.
 */
export interface CursorColumnDefinition {
    /**
     * Identifier or interal name for the column.
     */
    name: string;

    /**
     * Whether or not the column can be sorted.
     */
    sortable: boolean;

    /**
     * Whether or not the column can be filtered.
     */
    filterable: boolean;
}
