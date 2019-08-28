/**
 * Whether the given value is a valid JSON pointer.
 *
 * @param pointer Variable to test.
 *
 * @return If this method returns true, it is still possible that the variable is a star pointer. (As in theory a star is a valid dictionary key name.)
 */
export function isJsonPointer(pointer: string): boolean {
    if (typeof pointer !== 'string') {
        return false;
    }
    if (pointer === '') {
        return true;
    }
    if (pointer.substr(0, 1) !== '/' || pointer.substr(pointer.length - 1) === '/') {
        return false;
    }
    return true;
}

/**
 * Whether the given value is a JSON Star pointer.
 *
 * @param pointer Variable to test.
 *
 * @return If this method returns true the value is a Star pointer.
 */
export function isStarPointer(pointer: string): boolean {
    if (!isJsonPointer(pointer)) {
        return false;
    }
    return pointer.split('/').some(x => x === '*');
}

/**
 * Check whether the given pointer is a relative pointer.
 *
 * Examples of relative JSON-Pointers
 * - 0 - Get our own value.
 * - 1/0 - Move up one step, and get the index 0 of the parent array.
 * - 2/highly/nested/objects - Move up 2 steps, and resolve the rest as an JSON-Pointer
 * - 0# - Get the key of a parent object.
 * @link rfc https://tools.ietf.org/html/draft-handrews-relative-json-pointer-00
 *
 * @param pointer The pointer to verify, whether it is likely an relative pointer.
 */
export function isRelativeJsonPointer(pointer: string): boolean {
    if (typeof pointer !== 'string') {
        return false;
    }
    if (pointer === '') {
        return true;
    }
    if (pointer.length < 2) {
        return false;
    }
    var parts = pointer.split('/');
    if (parts.length === 1 && pointer.substr(pointer.length - 1) === '#' && Number.isNaN(parseInt(pointer.substr(0, pointer.length - 1)))) {
        return true;
    }
    if (parts[0] === '') {
        return false;
    }
    if (!Number.isNaN(parseInt(parts[0], 10))) {
        return false;
    }
    return true;
}

/**
 * Whether or not the given pointer is an absolutely pointer JSON-pointer. (With a schema included).
 *
 * Examples of absolute JSON-Pointers:
 * - https://example.org/schemas/lipsum#/somewhere/in/the/object
 * - https://example.org/schemas/lipsum#/0/somewhere/in/the/object
 *
 * @param pointer The pointer to verify, whether it is likely an absolute pointer.
 */
export function isAbsoluteJsonPointer(pointer: string): boolean {
    return !isRelativeJsonPointer(pointer) && String(pointer).indexOf('#/') >= 0;
}
