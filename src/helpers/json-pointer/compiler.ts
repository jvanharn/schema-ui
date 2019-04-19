import { parsePointerRootAdjusted } from './parser';
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
        sourceCode += `\n// index(${i}) = ${pntr[i]}\nkey = ${JSON.stringify(pntr[i])};\n`;

        if (pntr[i] === '-') {
            throw new Error(`The given pointer "${pointer}" is not valid for a read-only operation; ` +
                'the special dash dash-part (-) always indicates a non-existing element');
        }
        if (pntr[i] === '*') {
            sourceCode += `
if (Array.isArray(current)) {
    if (current.length > 0) {
        key = '0';
    }
    else {
        throw new Error(\`The given pointer "${pointer}" does not exist (at part ${i}).\`);
    }
}
else {
    var keys = Object.keys(current);
    if (keys.length > 0) {
        key = keys[0];
    }
    else {
        throw new Error(\`The given pointer "${pointer}" does not exist (at part ${i}).\`);
    }
}
`;
        }

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
            sourceCode += `return current[key];\n`;
        }
        else {
            var nextKey: string | number = Number.parseInt(pntr[i + 1]);
            if (Number.isNaN(nextKey)) {
                nextKey = pntr[i + 1];
            }
            sourceCode += `
if (current[key] === void 0) {
    current = generator(current, key, ${JSON.stringify(nextKey)}, ${JSON.stringify(pntr)});
    if (current == null) {
        return current;
    }
}
else {
    current = current[key];
}
`;
        }

        sourceCode += `//endof index(${i})\n`;
    }

    var compiled = new Function('generator', 'data', sourceCode);
    return function generatedPointerGetAccessor(data: any): any { return compiled(defaultGenerator, data); };
}
