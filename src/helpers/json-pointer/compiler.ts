import { parsePointerRootAdjusted, createPointer } from './parser';
import { PointerDefaultValueGenerator } from './retrieval';

/**
 * Create an accessor function to get the value of any Star-, Relative- or regular JSON pointer.
 *
 * If the pointer is a star pointer, the method created will just return the first element/key value from an array or object.
 *
 * @param pointer The pointer that has to be retrieved from the data.
 * @param root A pointer that points to the contextual root, used for relative pointers.
 * @param defaultGenerator Default value generator, that can provide us with default value for a pointer, so we can continue.
 *
 * @return Generated/compiled pointer accessor function.
 */
export function compilePointerGet(
    pointer: string, root: string = '/',
    defaultGenerator: PointerDefaultValueGenerator = (cur: string) => { throw new Error(`The given pointer "${pointer}" does not exist (at part ${cur}).`); }
): (data: any) => any {
    var parsed = parsePointerRootAdjusted(pointer, root);
    if (typeof parsed === 'string') {
        return function() { return parsed; };
    }

    var sourceCode = `// pointerGet: ${pointer}\nif (data == null) { return; }\nvar current = data;\nvar key;\n`;
    var isLast = pointer.length === 1;
    var pntr = parsed[0];
    for (var i = 0; i < pntr.length; i++) {
        isLast = pntr.length === i + 1;
        sourceCode += `\n// index(${i}) = ${pntr[i]}\n`;
        var currentKey = JSON.stringify(pntr[i]);

        if (pntr[i] === '-') {
            throw new Error(`The given pointer "${pointer}" is not valid for a read-only operation; ` +
                'the special dash dash-part (-) always indicates a non-existing element');
        }
        else if (pntr[i] === '*') {
            sourceCode += `
if (Array.isArray(current)) {
    if (current.length > 0) {
        ${generateGetOrDefault('\'0\'', createPointer(pntr.slice(0, i + 1), true))}
    }
    else {
        throw new Error(\`The given pointer "${pointer}" does not exist (at part ${i}).\`);
    }
}
else {
    var keys = Object.keys(current);
    if (keys.length > 0) {
        ${generateGetOrDefault('keys[0]', createPointer(pntr.slice(0, i + 1), true))}
    }
    else {
        throw new Error(\`The given pointer "${pointer}" does not exist (at part ${i}).\`);
    }
}
`;
        }
        else {
            var curKey = Number.parseInt(pntr[i], 10);
            if (Number.isNaN(curKey)) {
                sourceCode += `
if (Array.isArray(current)) {
    throw new Error(\`The given pointer "${pointer}" is NaN/not an index for array value (at part ${i}).\`);
}
`;
            }
            else if (curKey < 0) {
                sourceCode += `
if (Array.isArray(current)) {
    throw new Error(\`The given pointer "${pointer}" is out of bounds for array value (at part ${i}).\`);
}
`;
            }

            if (isLast) {
                sourceCode += `return current[${currentKey}];\n`;
            }
            else {
                sourceCode += generateGetOrDefault(currentKey, createPointer(pntr.slice(0, i + 1), true));
            }
        }

        sourceCode += `//endof index(${i})\n`;
    }

    var compiled = new Function('generator', 'data', sourceCode);
    return function generatedPointerGetAccessor(data: any): any { return compiled(defaultGenerator, data); };
}

/**
 * Generates a piece of code that either gets the given key, or calls a generate method to get a default.
 * @param key The JS encoded key to fetch from (like: "something" or 1)
 * @param pointer
 */
function generateGetOrDefault(key: string, pointer: string): string {
    return `
if (current[${key}] === void 0) {
    current = generator(current, '${pointer}');
    if (current == null) {
        return current;
    }
}
else {
    current = current[${key}];
}
`;
}
