import { parsePointerRootAdjusted } from './parser';

import * as debuglib from 'debug';
const debug = debuglib('schema:agent:json-pointer:assignment');

/**
 * Set all the possible values for any Star-, Relative- or regular JSON pointer.
 *
 * This like pointerGetAll in the sense that it sets all instances for Star pointers.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data.
 * @param value The new value for the given pointer.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 *
 * @return An list of the absolute JSON-pointers (without * or -) of the affected values.
 */
export function pointerSet(data: any, pointer: string, value: any, root: string = '/'): string[] {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        throw new Error('We do not support changing the key of a value with relative pointers.');
    }

    var affected: string[] = [];
    var current = data;
    var isLast = parsed.length === 1;
    for (var i = 0; i < parsed.length; i++) {
        isLast = parsed.length === i + 1;
        if (Array.isArray(current)) {
            if (parsed[i] === '-') {
                if (!isLast) {
                    throw new Error(`The given pointer "${pointer}" is not valid for a set operation; the special dash dash-part (-) must always come last.`);
                }
                affected.push('/' + parsed.slice(0, i - 1).join('/') + '/' + current.length);
                current[current.length] = value;
                return affected;
            }
            if (parsed[i] === '*') {
                if (current.length === 0) {
                    return affected;
                }
                else {
                    var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
                    for (var k = 0; k < current.length; k++) {
                        affected.concat(pointerSet(data, prefix + k, value));
                    }
                    return affected;
                }
            }

            var index = Number.parseInt(parsed[i], 10);
            if (Number.isNaN(index)) {
                throw new Error(`The given pointer "${pointer}" is NaN/not an index for array value (at part ${i}).`);
            }
            if (index > current.length) {
                throw new Error(`The given pointer "${pointer}" is out of bounds for array value (at part ${i}).`);
            }

            if (isLast) {
                affected.push(pointer);
                current[index] = value;
                return affected;
            }
            else if (current[index] === void 0) {
                // check if next is likely array acessor or object
                if (Number.isNaN(Number.parseInt(parsed[i + 1]))) {
                    current = current[index] = {};
                }
                else {
                    current = current[index] = [];
                }
            }
            else {
                current = current[index];
            }
        }
        else if (typeof current === 'object') {
            if (parsed[i] === '*') {
                var keys = Object.keys(current);
                if (keys.length === 0) {
                    return [];
                }
                else {
                    var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
                    for (var key of keys) {
                        affected.concat(pointerSet(data, prefix + key, value));
                    }
                    return affected;
                }
            }

            if (!Object.prototype.hasOwnProperty.apply(current, [parsed[i]])) {
                throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
            }

            if (isLast) {
                affected.push(pointer);
                current[parsed[i]] = value;
                return affected;
            }
            else if (current[parsed[i]] === void 0) {
                // check if next is likely array acessor or object
                if (Number.isNaN(Number.parseInt(parsed[i + 1]))) {
                    current = current[parsed[i]] = {};
                }
                else {
                    current = current[parsed[i]] = [];
                }
            }
            else {
                current = current[parsed[i]];
            }
        }
        else {
            throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
        }
    }

    return affected;
}

/**
 * Copy all the possible values for any Star-, Relative- or regular JSON pointer from the source to the target data object.
 *
 * @param data The data to retrieve the pointer from.
 * @param pointer The pointer that has to be retrieved from the data.
 * @param value The new value for the given pointer.
 * @param root A pointer that points to the contextual root for the source data object, used for relative pointers.
 *
 * @return The target data object.
 */
export function pointerCopy(source: any, pointer: string, target: any = {}, root: string = '/'): any {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        throw new Error('We do not support changing the key of a value with relative pointers.');
    }

    var current = source;
    var isLast = parsed.length === 1;
    for (var i = 0; i < parsed.length; i++) {
        isLast = parsed.length === i + 1;
        if (Array.isArray(current)) {
            if (parsed[i] === '-') {
                throw new Error(`The given pointer "${pointer}" is not valid for a set operation; the special dash dash-part (-) must always come last.`);
            }
            var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
            if (parsed[i] === '*') {
                if (current.length === 0) {
                    return target;
                }
                else {
                    if (isLast) {
                        for (var k = 0; k < current.length; k++) {
                            pointerSet(target, prefix + k, current[k]);
                        }
                    }
                    else {
                        var rest = '/' + parsed.slice(i + 1).join('/');
                        for (var k = 0; k < current.length; k++) {
                            pointerCopy(source, prefix + k + rest, target);
                        }
                    }
                    return target;
                }
            }

            var index = Number.parseInt(parsed[i], 10);
            if (Number.isNaN(index)) {
                throw new Error(`The given pointer "${pointer}" is NaN/not an index for array value (at part ${i}).`);
            }
            if (index > current.length) {
                throw new Error(`The given pointer "${pointer}" is out of bounds for array value (at part ${i}).`);
            }

            if (isLast) {
                pointerSet(target, prefix + index, current[index]);
                return target;
            }
            else if (current[index] === void 0) {
                // check if next is likely array acessor or object
                if (Number.isNaN(Number.parseInt(parsed[i + 1]))) {
                    current = current[index] = {};
                }
                else {
                    current = current[index] = [];
                }
            }
            else {
                current = current[index];
            }
        }
        else if (typeof current === 'object') {
            var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
            if (parsed[i] === '*') {
                var keys = Object.keys(current);
                if (keys.length === 0) {
                    return target;
                }
                else {
                    if (isLast) {
                        for (var key of keys) {
                            pointerSet(target, prefix + key, current[key]);
                        }
                    }
                    else {
                        var rest = '/' + parsed.slice(i + 1).join('/');
                        for (var key of keys) {
                            pointerCopy(source, prefix + key + rest, target);
                        }
                    }
                    return target;
                }
            }

            if (!Object.prototype.hasOwnProperty.apply(current, [parsed[i]])) {
                throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
            }

            if (isLast) {
                pointerSet(target, prefix + index, current[index]);
                return target;
            }
            else if (current[parsed[i]] === void 0) {
                // check if next is likely array acessor or object
                if (Number.isNaN(Number.parseInt(parsed[i + 1]))) {
                    current = current[parsed[i]] = {};
                }
                else {
                    current = current[parsed[i]] = [];
                }
            }
            else {
                current = current[parsed[i]];
            }
        }
        else {
            throw new Error(`The given pointer "${pointer}" does not exist (at part ${i}).`);
        }
    }

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

    var affected: string[] = [];
    var current = data;
    var isLast = parsed.length === 1;
    for (var i = 0; i < parsed.length; i++) {
        isLast = parsed.length === i + 1;
        if (Array.isArray(current)) {
            if (parsed[i] === '-') {
                if (!isLast) {
                    throw new Error(`The given pointer "${pointer}" is not valid for a set operation; the special dash dash-part (-) must always come last.`);
                }
                return affected;
            }
            if (parsed[i] === '*') {
                if (current.length === 0) {
                    return affected;
                }
                else {
                    var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
                    for (var k = 0; k < current.length; k++) {
                        affected.concat(pointerRemove(data, prefix + k, root));
                    }
                    return affected;
                }
            }

            var index = Number.parseInt(parsed[i], 10);
            if (Number.isNaN(index)) {
                debug(`pointerRemove; the given pointer "${pointer}" is NaN/not an index for array value (at part ${i}).`);
                return affected;
            }
            if (index > current.length) {
                debug(`pointerRemove; the given pointer "${pointer}" is out of bounds for array value (at part ${i}).`);
                return affected;
            }

            if (isLast) {
                affected.push(pointer);
                current.splice(index, 1);
                return affected;
            }
            else {
                current = current[index];
            }
        }
        else if (typeof current === 'object') {
            if (parsed[i] === '*') {
                var keys = Object.keys(current);
                if (keys.length === 0) {
                    return affected;
                }
                else {
                    var prefix = '/' + parsed.slice(0, i - 1).join('/') + '/';
                    for (var key of keys) {
                        affected.concat(pointerRemove(data, prefix + key, root));
                    }
                    return affected;
                }
            }

            if (!Object.prototype.hasOwnProperty.apply(current, [parsed[i]])) {
                debug(`pointerRemove; the given pointer "${pointer}" does not exist (at part ${i}).`);
                return affected;
            }

            if (isLast) {
                affected.push(pointer);
                delete current[parsed[i]];
                return affected;
            }
            else {
                current = current[parsed[i]];
            }
        }
        else {
            debug(`pointerRemove; the given pointer "${pointer}" does not exist (at part ${i}).`);
            return affected;
        }
    }

    return affected;
}
