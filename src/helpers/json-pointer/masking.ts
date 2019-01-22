import { pointerRemove, pointerCopy } from './assignment';

/**
 * Modifies the given object to not include the given values.
 *
 * @param data The object to modify.
 * @param pointers The pointers to exclude (if they exist in the data).
 * @param root Root context pointer to relate to for relative pointers.
 */
export function pointerExclusionMask(data: any, pointers: string[], root?: string): any {
    for (var pointer of pointers) {
        pointerRemove(data, pointer, root);
    }
    return data;
}

/**
 * Creates a new object that only includes the given values.
 *
 * @param data The object to source the data from.
 * @param pointers The pointers to include in the new object (if they exist in the data).
 * @param root Root context pointer to relate to for relative pointers.
 */
export function pointerInclusionMask(data: any, pointers: string[], root?: string): any {
    var result = {};
    for (var pointer of pointers) {
        try {
            pointerCopy(data, pointer, result, root);
        }
        catch (e) {
            /* if it doesnt exist, it doesnt matter... */
            if (!(e && typeof e.message === 'string' && e.message.indexOf('does not exist') >= 0)) {
                throw e;
            }
        }
    }
    return result;
}
