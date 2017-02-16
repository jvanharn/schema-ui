import { CommonJsonSchema } from './common';

/**
 * JsonSchema with table extensions.
 *
 * This extension to JsonSchema adds a property that describes how to display this entity, when looking at it in a collection endpoint.
 */
export interface JsonTableSchema extends CommonJsonSchema {
    /**
     * Custom property that holds the column definitions for schema columns. Used to render the data-tables.
     */
    columns?: SchemaColumnDescriptor[];
}

/**
 * Schema column descriptor
 */
export interface SchemaColumnDescriptor {
    /**
     * The internal identifier for the column.
     */
    id: string;

    /**
     * The json pointer that points to the value in the json object.
     */
    path: string;

    /**
     * Type of column.
     * @default 'text'
     */
    type: string; // 'text' | 'numeric' | 'money' | 'monospaced' | 'keys' | 'image'

    /**
     * Whether or not the column is filterable.
     * @default false
     */
    filterable?: boolean;

    /**
     * Whether or not sortable is sortable.
     * @default false
     */
    sortable?: boolean;
}