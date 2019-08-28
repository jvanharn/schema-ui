import { parsePointerRootAdjusted, createPointer } from './parser';

import * as debuglib from 'debug';
import { iteratePointer } from './iteration';
const debug = debuglib('schema:agent:json-pointer:retrieval');

/**
 * Method that can be passed to a retrieval method to supply a default value for a key.
 *
 * @param pointer The path to generate a value for.
 * @param context The context data for the given value (the parent object/array)
 */
export type PointerDefaultValueGenerator = (pointer: string, context: any) => any;

/**
 * Get the value of any Star-, Relative- or regular JSON pointer.
 *
 * If the pointer is a star pointer, this method will just return the first element/key value from an array or object.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 * @param defaultGenerator Default value generator, that can provide us with default value for a pointer, so we can continue.
 *
 * @return
 */
export function pointerGet(
    data: any, pointer: string, root: string = '/',
    defaultGenerator: PointerDefaultValueGenerator = (cur: string) => { throw new Error(`The given pointer "${pointer}" does not exist (at part ${cur}).`); }
): any {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        return parsed;
    }

    return iteratePointer(
        data, parsed[0],
        (current, key) => {
            return current[key];
        },
        (current, currentKey, nextKey, pointer) => {
            return defaultGenerator(createPointer(pointer), current)
        }, false, true, 1)[0];
}

/**
 * Get all the possible values for any Star-, Relative- or regular JSON pointer.
 *
 * This does the same as pointerGet, except that it retrieves all possible value for every key that is marked with a star.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 * @param limit The maximum amount of possible values to retrieve for the given pointer.
 *
 * @return
 */
export function pointerGetAll(data: any, pointer: string, root: string = '/', limit: number = 40): any[] {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        debug(`[warn] this is not expected behaviour for a GetAll enabled pointer to refer to the key of its parent.`);
        return [parsed];
    }

    return iteratePointer(data, parsed[0], (current, key) => current[key], void 0, false, false, limit);
}

/**
 * Try and get the value of any Star-, Relative- or regular JSON pointer.
 *
 * If the pointer is a star pointer, this method will just return the first element/key value from an array or object.
 *
 * If the given value does not exist, will return undefined.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 * @param defaultGenerator Default value generator, that can provide us with default value for a pointer, so we can continue.
 *
 * @return
 */
export function tryPointerGet(data: any, pointer: string, root?: string, defaultGenerator?: PointerDefaultValueGenerator): any {
    try {
        return pointerGet(data, pointer, root, defaultGenerator);
    }
    catch {
        return void 0;
    }
}

/**
 * Check whether or not the given pointer exists in it's entirety.
 *
 * @param data The data to check the pointers existence in.
 * @param pointer The pointer to check.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 */
export function pointerHas(data: any, pointer: string, root: string = '/'): boolean {
    try {
        var parsed = parsePointerRootAdjusted(pointer, root);
        if (typeof parsed === 'string') {
            return false;
        }

        return iteratePointer(
            data, parsed[0],
            (current, key) => {
                if (current != null && (
                    (typeof current === 'object' && !Object.prototype.hasOwnProperty.call(current, key)) ||
                    (Array.isArray(current) && key >= 0 && key < current.length))
                ) {
                    return current[key];
                }
                else {
                    throw new Error();
                }
            },
            () => { throw new Error() }, false, true, 1)[0];
    }
    catch {
        return false;
    }
}
