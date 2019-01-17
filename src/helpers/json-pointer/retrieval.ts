import { parsePointerRootAdjusted } from './parser';

import * as debuglib from 'debug';
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

    var current = data;
    for (var i = 0; i < parsed.length; i++) {
        if (Array.isArray(current)) {
            if (parsed[i] === '-') {
                current = defaultGenerator('/' + parsed.slice(0, i - 1).join('/') + '/' + current.length, data);
            }
            if (parsed[i] === '*') {
                if (current.length === 0) {
                    current = defaultGenerator('/' + parsed.slice(0, i - 1).join('/') + '/' + current.length, data);
                }
                else {
                    current = current[0];
                }
            }

            var index = Number.parseInt(parsed[i], 10);
            if (Number.isNaN(index)) {
                throw new Error(`The given pointer "${pointer}" is NaN/not an index for array value (at part ${i}).`);
            }
            if (index > current.length) {
                throw new Error(`The given pointer "${pointer}" is out of bounds for array value (at part ${i}).`);
            }
            current = current[index];
        }
        else if (typeof current === 'object') {
            if (parsed[i] === '*') {
                var keys = Object.keys(current);
                if (keys.length === 0) {
                    throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
                }
                else {
                    current = current[keys[0]];
                }
            }

            if (!Object.prototype.hasOwnProperty.apply(current, [parsed[i]])) {
                current = defaultGenerator('/' + parsed.slice(0, i).join('/'), data);
            }
            current = current[parsed[i]];
        }
        else {
            throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
        }
    }

    return current;
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

    var current = data;
    for (var i = 0; i < parsed.length; i++) {
        if (Array.isArray(current)) {
            if (parsed[i] === '-') {
                throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
            }
            if (parsed[i] === '*') {
                if (current.length === 0) {
                    return [];
                }
                else {
                    var result: any[] = [];
                    var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
                    for (var k = 0; k < current.length; k++) {
                        result.concat(pointerGetAll(data, prefix + k, root, limit));
                        if (result.length >= limit) {
                            return result.splice(0, limit);
                        }
                    }
                    return result;
                }
            }

            var index = Number.parseInt(parsed[i], 10);
            if (Number.isNaN(index)) {
                throw new Error(`The given pointer "${pointer}" is NaN/not an index for array value (at part ${i}).`);
            }
            if (index > current.length) {
                throw new Error(`The given pointer "${pointer}" is out of bounds for array value (at part ${i}).`);
            }
            current = current[index];
        }
        else if (typeof current === 'object') {
            if (parsed[i] === '*') {
                var keys = Object.keys(current);
                if (keys.length === 0) {
                    return [];
                }
                else {
                    var result: any[] = [];
                    var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
                    for (var key of keys) {
                        result.concat(pointerGetAll(data, prefix + key, root, limit));
                        if (result.length >= limit) {
                            return result.splice(0, limit);
                        }
                    }
                    return result;
                }
            }

            if (!Object.prototype.hasOwnProperty.apply(current, [parsed[i]])) {
                throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
            }
            current = current[parsed[i]];
        }
        else {
            throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
        }
    }

    return [current];
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