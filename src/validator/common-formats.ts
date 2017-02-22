import { Ajv } from 'ajv';
import * as _ from 'lodash';

// ISO8601 validation regexp.
const iso8601RegExp = new RegExp(
    '^([\\+-]?\\d{4}(?!\\d{2}\\b))((-?)((0[1-9]|1[0-2])(\\3([12]\\d|0[1-9]|3[01]))?|W([0-4]\\d|5[0-2])(-?[1-7])?' +
    '|(00[1-9]|0[1-9]\\d|[12]\\d{2}|3([0-5]\\d|6[1-6])))([T\\s]((([01]\\d|2[0-3])((:?)[0-5]\\d)?|24\\:?00)([\\.,]' +
    '\\d+(?!:))?)?(\\17[0-5]\\d([\\.,]\\d+)?)?([zZ]|([\\+-])([01]\\d|2[0-3]):?([0-5]\\d)?)?)?)?'
);

/**
 * A class containing common (non-async) formats for use in schema's.
 */
export class CommonFormats {
    /**
     * EAN 13 formatter.
     */
    public static ean(value: string): boolean {
        var checkSum = value
            .split('')
            .reduce(function (p: number, v: string, i: number): number {
                return i % 2 === 0 ? p + 1 * parseInt(v, 10) : p + 3 * parseInt(v, 10);
            }, 0);
        return !(checkSum % 10 !== 0);
    }

    /**
     * ISO 8601 validator.
     */
    public static iso8601(str: string): boolean {
        if (typeof str !== 'string') {
            return false;
        }
        return iso8601RegExp.test(str);
    }
}
