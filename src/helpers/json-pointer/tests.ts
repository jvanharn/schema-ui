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
 * @param pointer
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
    if (!Number.isNaN(parseInt(parts[0]))) {
        return false;
    }
    return true;
}
