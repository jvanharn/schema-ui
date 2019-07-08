import { ICursor } from './cursor';

/**
 * Cursor that supports having columns (like when using them for JsonTableSchema resources).
 */
export interface IMaskableCursor<T> extends ICursor<T> {
    /**
     * A list of JSON-Pointers that describe what fields should be included in the response, in order to reduce response data size. (May be ignored by agent)
     */
    mask: string[];

    /**
     * Whether or not the last changes to the mask have been applied.
     */
    isMaskApplied: boolean;
}
