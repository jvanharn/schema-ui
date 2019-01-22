import { parsePointerRootAdjusted, createPointer } from './parser';

import * as debuglib from 'debug';
import { iteratePointer } from './iteration';
const debug = debuglib('schema:agent:json-pointer:assignment');

/**
 * Set all the possible values for any Star-, Relative- or regular JSON pointer.
 *
 * This like pointerGetAll in the sense that it sets all instances for Star pointers.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data. (Or an already parsed pointer)
 * @param value The new value for the given pointer.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 *
 * @return An list of the absolute JSON-pointers (without * or -) of the affected values.
 */
export function pointerSet(data: any, pointer: string | string[], value: any, root: string = '/'): string[] {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        throw new Error('pointerSet; You cannot set the root item key!');
    }

    var [pntrParts, pntrMod] = parsed;

    return iteratePointer(data, pntrParts, (current, key, targetPointer) => {
        if (pntrMod === '#') {
            if (typeof current[key] !== 'object') {
                current[key] = {};
            }

            if (Array.isArray(value)) {
                for (var k of value) {
                    current[key][String(k)] = {};
                }
            }
            else if (!(String(value) in current[key])) {
                current[key][String(value)] = {};
            }
        }
        else {
            current[key] = value;
        }
        return createPointer(targetPointer);
    }, void 0, true, false);
}

/**
 * Copy all the possible values for any Star-, Relative- or regular JSON pointer from the source to the target data object.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data. (Or a preparsed array of pointer parts)
 * @param value The new value for the given pointer.
 * @param root A pointer that points to the contextual root for the source data object, used for relative pointers.
 *
 * @return The target data object.
 */
export function pointerCopy(source: any, pointer: string | string[], target: any = {}, root: string = '/'): any {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        throw new Error('pointerCopy; We can not copy the key of the root (root can haz no key, root = root, lalalala).');
    }

    var [pntrParts, pntrMod] = parsed;
    iteratePointer(source, pntrParts, (current, key, targetPointer) => {
        var val = current[key] as any;
        if (pntrMod === '#') {
            if (typeof val === 'object') {
                val = Object.keys(val);
            }
            else if (Array.isArray(val)) {
                val = [];
                for (var i = 0; i < val.length; i++) {
                    if (typeof val[i] === 'object') {
                        val.push({});
                    }
                    else if (Array.isArray(val[i])) {
                        val.push([]);
                    }
                    else {
                        val.push(void 0);
                    }
                }
            }
            else {
                val = void 0;
            }
        }

        return pointerSet(target, createPointer(targetPointer) + (pntrMod == null ? '' : pntrMod), val)[0];
    }, void 0, false, false);

    return target;
}

/**
 * Unset all the data at the possible locations for any Star-, Relative- or regular JSON pointer.
 *
 * This like pointerSet but instead of setting to a value, it removes the value from the given location.
 *
 * @param data The data to remove the data at the pointer location from.
 * @param pointer The pointer that has to be removed from the data.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 *
 * @return An list of the absolute JSON-pointers (without * or -) of the affected values.
 */
export function pointerRemove(data: any, pointer: string, root: string = '/'): string[] {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        throw new Error('We do not support removing the key of a value with relative pointers.');
    }

    return iteratePointer(data, parsed[0], (current, key, pointer) => {
        delete current[key];
        return createPointer(pointer);
    }, void 0, false, false);
}
