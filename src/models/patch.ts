export type JsonPatchOperationName = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';

/**
 * JSON Patch Operation Definition
 */
export interface JsonPatchOperation
{
    /**
     * The operation to perform.
     * OneOf: add, remove, replace, copy, move, test
     */
    op: JsonPatchOperationName;

    /**
     * Json Path.
     * When moving or copying; the previous location of the variable.
     */
    from?: string;

    /**
     * Json Path.
     * When moving or copying; the target location of the variable.
     */
    to?: string;

    /**
     * The Json path to perform the operation on. Valid for test, replace, remove, add.
     */
    path?: string;

    /**
     * New value, used for add, replace and test.
     */
    value?: any;
}
