export type PointerRoot = null | number;
export type PointerParts = string[];
export type PointerModifier = null | '#';

/**
 * Splits a pointer up in it's individual parts.
 *
 * Implements as closely as possible to support both RFC6901 (https://tools.ietf.org/html/rfc6901) and IETF draft-handrews-relative-json-pointer-00 (https://tools.ietf.org/id/draft-handrews-relative-json-pointer-00.html)
 *
 * @param pointer
 *
 * @return A tuple consisting of the relative part (to what it is relative), the array of the parts of the pointer, and a modifier (Whether or not to retrieve the Key of the given pointer).
 */
export function parsePointer(pointer: string): [PointerRoot, PointerParts, PointerModifier] {
    var decoded = String(pointer).split('/').map(part => part.replace('~0', '~').replace('~1', '/'));
    var root = decoded.shift();

    // Correct for relative key pointer
    if (decoded.length === 0 && root.substr(root.length - 1) === '#') {
        var num = Number.parseInt(root.substr(0, root.length - 1), 10);
        if (!Number.isNaN(num)) {
            return [num, [], '#'];
        }
        else {
            throw new Error(`JSON-Pointer parse error; expected the given relative pointer "${pointer}" to have either a # or absolute JSON-Pointer after the parent item.`);
        }
    }

    // Check if there is a key selector in the last part
    var modifier: PointerModifier = null;
    var last = decoded[decoded.length - 1];
    if (decoded.length > 0 && decoded[decoded.length - 1].substr(-1) === '#') {
        modifier = '#';

        if (last.substr.length > 1) {
            decoded[decoded.length - 1] = last.substr(0, last.length - 1);
        }
        else {
            decoded.pop();
        }
    }

    // Base JSON spec
    if (root === '' || root == null) {
        return [null, decoded, modifier];
    }

    // Relative pointer
    var num = Number.parseInt(root, 10);
    if (!Number.isNaN(num)) {
        return [num, decoded, modifier];
    }

    // Unknown pointer type.
    throw new Error(`Unable to parse the given JSON-Pointer "${pointer}"; it was not a correctly formatted JSON-Pointer.`);
}

/**
 * Splits and adjusts the given pointer for the given root pointer.
 *
 * @param pointer The pointer to adjust for the given root, or an already parsed array of pointer elements.
 * @param rootPointer The root pointer to which the pointer parts will be adjusted.
 *
 * @return If the pointer is a relative pointer, and it requested the key, it will return a single key. If not if will return the concatenated/adjusted pointer parts to navigate through.
 */
export function parsePointerRootAdjusted(pointer: string | string[], rootPointer: string): [PointerParts, PointerModifier] | string {
    // Already parsed
    if (Array.isArray(pointer)) {
        return [pointer, null];
    }

    // Parse the pointer itself, and check whether it is root relative.
    var [pntrRoot, pntrParts, pntrMod] = parsePointer(pointer);

    // No relativity
    if (pntrRoot === null) {
        return [pntrParts, pntrMod];
    }

    // Parse the root too, since well need to process it.
    var [, rootParts] = parsePointer(rootPointer);

    // Validate the pntrRoot against our bounds
    if (rootParts.length === 0) {
        throw new Error(`The relative pointer "${pntrRoot}#" cannot be executed, because the given context object is the absolute root of the item.`);
    }
    if (pntrRoot >= rootParts.length) {
        throw new Error(`The relative pointer "${pntrRoot}#" cannot be executed, because the given amount of ${pntrRoot} step up, is out of bounds of the tree of ${rootParts.length - 1} items.`);
    }
    if (pntrRoot < 0) {
        throw new Error('Relative pointers cannot have negative root relative pointers.');
    }

    // Fetch the key, instead of the value
    if (pntrMod === '#') {
        return rootParts[rootParts.length - 1 - pntrRoot];
    }

    // Fetch the value, adjust the root pointer
    if (pntrRoot === rootParts.length) {
        return [pntrParts, pntrMod];
    }
    return [rootParts.slice(0, pntrRoot).concat(pntrParts), pntrMod];
}

/**
 * Encode an array of json-pointer parts to a JSON-Pointer.
 *
 * @param parts
 * @param leadingSlash
 *
 * @return Correctly encoded JSON Pointer.
 */
export function createPointer(parts: string[], leadingSlash?: boolean): string {
    if (!Array.isArray(parts)) {
        throw new Error('Expected the parts to be an array.');
    }
    if (parts.length === 0) {
        return leadingSlash ? '/' : '';
    }

    const pntr = '/' + parts.map(part => String(part || '').replace('~1', '/').replace('~0', '~')).join('/');
    return leadingSlash ? pntr + '/' : pntr;
}
