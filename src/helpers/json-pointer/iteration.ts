import * as _ from 'lodash';

/**
 * Method that is used by the library to iterate the given object.
 *
 * @param data
 * @param pointer
 * @param callback
 * @param generator
 * @param modifyOriginal
 * @param stopAfterFirst Whether or not to stop looking for other results after finding the first key that matches a STAR.
 * @param limit The maximum number of STAR keys to retrieve.
 */
export function iteratePointer<T>(
    data: any, pointer: string[],
    callback: (current: any, key: number | string, pointer: string[]) => T,
    generator: (current: any, currentKey: number | string, nextKey: number | string, pointer: string[]) => any =
        (current, currentKey, nextKey, pointer) => {
            if (modifyOriginal) {
                // check if next is likely array acessor or object
                if (typeof nextKey === 'string' || Number.isNaN(nextKey as number)) {
                    return current[currentKey] = {};
                }
                else {
                    return current[currentKey] = [];
                }
            }
            else {
                throw new Error(`The given pointer does not exist at "/${pointer.join('/')}" at key "${key}".`)
            }
        },
    modifyOriginal?: boolean, stopAfterFirst?: boolean, limit: number = 40
): T[] {
    var current = data;
    var isLast = pointer.length === 1;
    for (var i = 0; i < pointer.length; i++) {
        isLast = pointer.length === i + 1;

        if (pointer[i] === '-') {
            if (!Array.isArray(current)) {
                throw new Error(`The given pointer "/${pointer.join('/')}" is not valid for the given data; ` +
                    'cannot add/push new value to the end of an object, this only works on arrays.');
            }
            if (!isLast) {
                throw new Error(`The given pointer "/${pointer.join('/')}" is not valid; ` +
                    'the special dash dash-part (-) must always come last.');
            }
            if (!modifyOriginal) {
                throw new Error(`The given pointer "/${pointer.join('/')}" is not valid for a read-only operation; ` +
                    'the special dash dash-part (-) always indicates a non-existing element');
            }

            return [callback(current, current.length as any, pointer.slice(0, i).concat([current.length as any]))];
        }
        if (pointer[i] === '*') {
            var prefix = pointer.slice(0, i);
            var suffix = pointer.slice(i + 1);
            if (stopAfterFirst) {
                // if (_.isEmpty(current)) {
                //     current = generator(current, pointer[i], pointer[i + 1], prefix.concat(['*']));
                // }

                if (Array.isArray(current)) {
                    if (current.length > 0) {
                        pointer[i] = '0';
                    }
                    else {
                        throw new Error(`The given pointer "/${pointer.join('/')}" does not exist (at part ${i}).`);
                    }
                }
                else {
                    var keys = Object.keys(current);
                    if (keys.length > 0) {
                        pointer[i] = keys[0];
                    }
                    else {
                        throw new Error(`The given pointer "/${pointer.join('/')}" does not exist (at part ${i}).`);
                    }
                }
            }
            else {
                var num = 0;
                return _.flatMap(current, (v, k: string | number) => {
                    if (num++ > limit) {
                        return [];
                    }
                    return iteratePointer<T>(data, prefix.concat([k as any], suffix), callback, generator, modifyOriginal, stopAfterFirst);
                });
            }
        }

        var key: number | string = pointer[i];
        if (Array.isArray(current)) {
            key = Number.parseInt(pointer[i], 10);
            if (Number.isNaN(key)) {
                throw new Error(`The given pointer "/${pointer.join('/')}" is NaN/not an index for array value (at part ${i}).`);
            }
            if (key < 0) {
                throw new Error(`The given pointer "/${pointer.join('/')}" is out of bounds for array value (at part ${i}).`);
            }
            // if (key < 0 || key > current.length) {
            //     throw new Error(`The given pointer "/${pointer.join('/')}" is out of bounds for array value (at part ${i}).`);
            // }
        }

        // if (!Object.prototype.hasOwnProperty.apply(current, [key])) {
        //     throw new Error(`The given pointer "/${pointer.join('/')}" does not exist (at part ${i}).`);
        // }

        if (isLast) {
            return [callback(current, key, pointer)];
        }
        else if (current[key] === void 0) {
            // if (modifyOriginal) {
            //     // check if next is likely array acessor or object
            //     if (Number.isNaN(Number.parseInt(pointer[i + 1]))) {
            //         current = current[key] = {};
            //     }
            //     else {
            //         current = current[key] = [];
            //     }
            // }
            // else {
            //     throw new Error(`The given pointer "/${pointer.join('/')}" does not exist (at part ${i}).`);
            // }

            // Generate the next value of the tree externally, if possible (for example, source a default value from a JSON-schema)
            var nextKeyNum = Number.parseInt(pointer[i + 1]);
            current = generator(current, key, Number.isNaN(nextKeyNum) ? pointer[i + 1] : nextKeyNum, pointer);
        }
        else {
            current = current[key];
        }
    }

    debugger;
    throw new Error(`iteratePointer; This error should never be thrown.`);
}
