/**
 * Check the equality of two (star-)pointers.
 *
 * @param pointer Parsed pointer to check.
 * @param matchable Parsed pointer to check against.
 *
 * @return Whether or not the given pointer matches the given other pointer.
 */
export function isPointerEqual(pointer: string[], matchable: string[]): boolean {
    // Length must be equal
    if (pointer.length !== matchable.length) {
        return false;
    }

    for (var a = 0; a < pointer.length; a++) {
        if (!(matchable[a] === pointer[a] || matchable[a] === '*' || pointer[a] === '*')) {
            return false;
        }
    }

    return true;
}

/**
 * Check how equal two pointers are.
 *
 * @param pointer Parsed pointer to check.
 * @param matchable Parsed pointer to check against.
 *
 * @return A number indicating how much elements the pointer is shorter or longer than the original if it has any amount of matching elements. Returns NaN if the pointer do not match at all.
 */
export function matchPointer(pointer: string[], matchable: string[]): number {
    if (pointer.length === matchable.length) {
        // Same length requires exact match
        for (var a = 0; a < pointer.length; a++) {
            if (!(matchable[a] === pointer[a] || matchable[a] === '*')) {
                break;
            }
            if (a + 1 === pointer.length) {
                // last element so the pointer matched the mask completely, making the pointer blacklisted
                return 0; // --0
            }
        }
    }
    else if (pointer.length > matchable.length) {
        // The pointer is longer than the mask, and therefore possibly a child of one of the excluded properties
        for (var b = 0; b < matchable.length; b++) {
            if (!(matchable[b] === pointer[b] || matchable[b] === '*')) {
                break;
            }
            if (b + 1 === matchable.length) {
                // last element so the pointer is a child of the blacklisted item, and therefore is blacklisted
                return pointer.length - matchable.length; // +1
            }
        }
    }
    else {
        // The pointer is shorter than the mask, and therefore possibly a parent of one of the excluded properties
        for (var c = 0; c < pointer.length; c++) {
            if (!(matchable[c] === pointer[c] || matchable[c] === '*')) {
                break;
            }
            if (c + 1 === pointer.length) {
                // last element, so the pointer is a parent of a blacklisted property, and therefore the value should probably be checked.
                return pointer.length - matchable.length; // -1
            }
        }
    }

    return Number.NaN;
}
