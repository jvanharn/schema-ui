import { JsonSchema, CommonJsonSchema } from './models/index';
import { SchemaNavigator } from './schema-navigator';
import { ISchemaCache } from './cache/schema-cache';
import { ISchemaFetcher } from './fetchers/schema-fetcher';

import * as _ from 'lodash';
import zschema = require('z-schema');

//region Register all custom format validators
    // Validates EAN13 checksums.
    zschema.registerFormat('ean', (value) => {
        var checkSum = value
            .split('')
            .reduce(function (p: number, v: string, i: number): number {
                return i % 2 === 0 ? p + 1 * parseInt(v, 10) : p + 3 * parseInt(v, 10);
            }, 0);
        return !(checkSum % 10 !== 0);
    });

    // ISO 8601 validator
    const iso8601RegExp = new RegExp(
        '^([\\+-]?\\d{4}(?!\\d{2}\\b))((-?)((0[1-9]|1[0-2])(\\3([12]\\d|0[1-9]|3[01]))?|W([0-4]\\d|5[0-2])(-?[1-7])?' +
        '|(00[1-9]|0[1-9]\\d|[12]\\d{2}|3([0-5]\\d|6[1-6])))([T\\s]((([01]\\d|2[0-3])((:?)[0-5]\\d)?|24\\:?00)([\\.,]' +
        '\\d+(?!:))?)?(\\17[0-5]\\d([\\.,]\\d+)?)?([zZ]|([\\+-])([01]\\d|2[0-3]):?([0-5]\\d)?)?)?)?'
    );
    zschema.registerFormat('iso8601', (str: string) => {
        if (typeof str !== 'string') {
            return false;
        }
        return iso8601RegExp.test(str);
    });
//endregion

/**
 * Class that helps with the validation of a schema or it's properties.
 */
export class SchemaValidator {
    /**
     * The Schema validator.
     */
    private _validator: ZSchema.Validator;

    /**
     * @param schema Schema to validate with.
     * @param cache The cache to fetch any missing schema references with.
     * @param fetcher The fetcher to fetch schemas missing from the cache from.
     */
    public constructor(
        public readonly schema: SchemaNavigator,
        protected readonly cache?: ISchemaCache,
        protected readonly fetcher?: ISchemaFetcher
    ) {
        this._validator = new zschema({
            noExtraKeywords: false,
            breakOnFirstError: false,
            //ignoreUnresolvableReferences: true
        });
    }

    /**
     * Validate entity item instance with the entire schema.
     *
     * @param item The item that should be validated by the schema this schema-validator represents.
     *
     * @return The result of the validation.
     */
    public validate<T>(item: T): Promise<ValidationResult> {
        return this._validateDefinition(this.schema.root, item);
    }

    /**
     * Validate the property with the given name.
     *
     * @param propertyName The name of the property to validate (as an sub-schema).
     * @param value The value to validate with the schema.
     *
     * @return The result of the validation.
     */
    public validateProperty(propertyName: string, value: any): Promise<ValidationResult> {
        return this._validateDefinition(this.schema.propertyRoot[propertyName], value);
    }

    /**
     * Internal method for validating using the z-schema library.
     *
     * @todo Replace this with our own implementation (The caching is now done twice etc.)
     *
     * @param definition Definition of the schema to validate the value with.
     * @param value The value to validate with the schema.
     *
     * @return The result of the validation.
     */
    private _validateDefinition(definition: JsonSchema, value: any): Promise<ValidationResult> {
        return new Promise<ValidationResult>((resolve, reject) => {
            try {
                this._validator.validate(value, definition, (errors: ZSchema.SchemaError[], valid: boolean) => {
                    // JIT Schema-Definition loading
                    if (!valid && this._isMissingLocalReferences(errors)) {
                        this._loadLocalReferencesFromError(definition, errors)
                            .then(def =>
                                this._validateDefinition(def, value)
                                    .then(resolve)
                                    .catch(reject))
                            .catch(reject);
                    }

                    // All went well
                    else {
                        resolve({
                            errors: errors,
                            valid: valid
                        });
                    }
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Whether or not it is missing local references that we can load.
     */
    private _isMissingLocalReferences(errors: ZSchema.SchemaError[]): boolean {
        return _.some(errors, x => x.code === 'UNRESOLVABLE_REFERENCE');
    }

    /**
     * Takes an array of missing reference errors, and fixes them on the given definition (Or throws an error).
     */
    private _loadLocalReferencesFromError(descriptor: JsonSchema, errors: ZSchema.SchemaError[]): Promise<JsonSchema> {
        return new Promise((resolve, reject) => {
            var def: JsonSchema = _.assign({}, descriptor) as any;
            if (!def.definitions) {
                def.definitions = {};
            }

            delete def.id; // @todo dirty fix?

            var promises: Promise<JsonSchema>[] = [];
            for (let i = 0; i < errors.length; i++) {
                if (errors[i].code !== 'UNRESOLVABLE_REFERENCE') {
                    continue;
                }

                let ref = errors[i].params[0];
                let ids = this.schema.getSchemaIdsWithPointers();
                if (!!_.includes(ids, ref)) {
                    throw new Error('Error seems invalid, the requested reference is already set!');
                }

                // Get the schema somehow.
                let cached: JsonSchema;
                if (!!this.cache && !!(cached = this.cache.getSchema(ref))) {
                    promises.push(Promise.resolve(cached));
                }
                else if(!!this.fetcher) {
                    promises.push(this.fetcher.fetchSchema(ref));
                }
                else {
                    reject(`SchemaValidator._loadLocalReferencesFromError: Cannot find schema $ref "${ref}"! (using cache: ${!!this.cache}, using fetcher: ${!!this.fetcher})`);
                }
            }

            Promise
                .all(promises)
                .then((defs: JsonSchema[]) => {
                    for (var i = 0; i < defs.length; i++) {
                        // Determine definition key
                        let key = defs[i].id,
                            hashIndex: number,
                            slashIndex: number;
                        // Try to set it as entity key.
                        if (!!(defs[i] as CommonJsonSchema).entity && !def.definitions[(defs[i] as CommonJsonSchema).entity]) {
                            key = (defs[i] as CommonJsonSchema).entity;
                        }
                        else if ((hashIndex = defs[i].id.lastIndexOf('#')) > 0 && (slashIndex = defs[i].id.lastIndexOf('/', hashIndex)) > 0) {
                            key = defs[i].id.substr(slashIndex);
                        }

                        // Set the def
                        def.definitions[key] = defs[i];
                        this._addAllDefinitionsAsRemotes(defs[i]);
                    }
                    resolve(def);
                })
                .catch(reject);
        });
    }

    /**
     * Add the given definition and all children as remotes, if possible.
     */
    private _addAllDefinitionsAsRemotes(definition: JsonSchema): void {
        if (definition.id.substr(0, 4) === 'http') {
            this._validator.setRemoteReference(this._cleanupIdentity(definition.id), definition);
        }

        if (!!definition.definitions) {
            _.each(
                definition.definitions,
                v => {
                    if (definition.id.substr(0, 4) === 'http') {
                        this._validator.setRemoteReference(this._cleanupIdentity(v.id), v);
                    }
                });
        }
    }

    /**
     * Cleans an identity by removing it's hash/json-pointer part.
     */
    private _cleanupIdentity(id: string): string {
        return _.head(id.split('#', 2));
    }

    /**
     * Shortcut method for creating an SchemaValidator.
     */
    public static fromSchema(schema: JsonSchema, cache?: ISchemaCache, fetcher?: ISchemaFetcher): SchemaValidator {
        return new SchemaValidator(new SchemaNavigator(schema), cache, fetcher);
    }
}

/**
 * Struct used for returning validation results.
 */
export interface ValidationResult {
    /**
     * List of all errors.
     */
    errors: ValidationError[];

    /**
     * Whether or not the validation succeeded.
     */
    valid: boolean;
}

/**
 * Defines an validation error and it's properties.
 */
export interface ValidationError {
    /**
     * The code of the error, that gives an unique descriptor about what is wrong.
     */
    code: string;

    /**
     * Description of the error in english.
     * @ignore
     * @deprecated
     */
    description: string;

    /**
     * Description of the error in english.
     * @ignore
     * @deprecated
     */
    message: string;

    /**
     * Parameters for use with the error message about what specifically was wrong with the value, depends on the code.
     */
    params: string[];

    /**
     * JSON Pointer to the value that this error applies to.
     */
    path: string;
}
