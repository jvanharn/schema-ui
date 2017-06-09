import { JsonSchema, CommonJsonSchema, JsonPatchOperation } from '../models/index';
import { SchemaNavigator } from '../navigator/schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';

import { CommonFormats } from './common-formats';
import { ISchemaValidator, ValidationError, ValidationResult } from './schema-validator';

import * as ajv from 'ajv';
import * as _ from 'lodash';
import * as pointer from 'json-pointer';
import * as debuglib from 'debug';
var debug = debuglib('schema:validator:ajv');

/**
 * Class that helps with the validation of a schema or it's properties.
 */
export class AjvSchemaValidator implements ISchemaValidator {
    /**
     * Formats globally registered.
     */
    protected static formats: { [name: string]: (str: string) => boolean } = { };

    /**
     * The Schema validator.
     */
    protected validator: ajv.Ajv;

    /**
     * The compiled main schema.
     */
    protected compiledSchema: Promise<ajv.ValidateFunction>;

    /**
     * @param schema Schema to validate with.
     * @param cache The cache to fetch any missing schema references with.
     * @param fetcher The fetcher to fetch schemas missing from the cache from.
     */
    public constructor(
        public readonly schema: SchemaNavigator,
        protected readonly cache?: ISchemaCache,
        protected readonly fetcher?: ISchemaFetcher,
        options?: ajv.Options
    ) {
        debug(`initialized AJV Schema Validator for schema.$id "${schema.original.id || schema.schemaId}"`);

        this.validator = new ajv(
            _.assign({
                formats: _.assign({}, CommonFormats, AjvSchemaValidator.formats),
                loadSchema: (uri: string, cb: (err: Error, schema: Object) => any) =>
                    this.resolveMissingSchemaReference(uri)
                        .then(x => {
                            // Catch any errors about the given schema already being registered.
                            try {
                                cb(null, x);
                            }
                            catch (e) {
                                debug('[warn] error ocurred whilst calling callback off requested ajv-schema, ironically: ', e);
                            }
                        })
                        .catch(e => cb(e, void 0)),
                inlineRefs: false
            } as ajv.Options, options));

        // this.validator.addKeyword('field', {
        //     metaSchema: {
        //         type: "object",
        //         properties: {
        //             type: {
        //                 type: "string"
        //             },
        //             visible: {
        //                 type: "boolean"
        //             },
        //             data: {
        //                 type: "object"
        //             },
        //             link: {
        //                 oneOf: [
        //                     { type: "string" },
        //                     { type: "integer" }
        //                 ]
        //             },
        //             targetIdentity: {
        //                 type: "string"
        //             }
        //         },
        //         dependencies: {
        //             targetIdentity: ["link"]
        //         },
        //         additionalProperties: false
        //     } as JsonSchema
        // } as any);

        this.compiledSchema = new Promise((resolve, reject) =>
            this.validator.compileAsync(this.schema.original, (err, validate) => {
                if (err == null) {
                    debug(`compiled ajv schema validator for schema.$id "${schema.original.id || schema.schemaId}"`);
                    resolve(validate);
                }
                else if (_.endsWith(err.message, 'already exists')) {
                    debug(`[error] compilation failed of schema [${this.schema.schemaId}] because of a race condition triggered when multiple ajv.compileAsync calls are triggered at the same time`);
                    debug('you can solve the above race condition by making sure they are always called in sequence, and never in parralel');
                    reject(err);
                }
                else {
                    debug(`[error] compilation failed of schema [${this.schema.schemaId}]: ${err.message}`);
                    reject(err);
                }
            }));
    }

    /**
     * Validate entity item instance with the entire schema.
     *
     * @param item The item that should be validated by the schema this schema-validator represents.
     *
     * @return The result of the validation.
     */
    public validate<T>(item: T): Promise<ValidationResult> {
        return this.compiledSchema.then(validator =>
            this.mapValidationResult(
                //@todo use the compiled schema and calculate the subpath (this shuould be possible with the newer json schemas)
                //validator(item, this.schema.propertyPrefix) as boolean,
                this.validator.validate(this.schema.schemaId, item),
                this.validator.errors));
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
        if (propertyName == null || propertyName.length <= 1) {
            return Promise.reject(new Error(`Invalid property name given "${propertyName}"`));
        }

        // @todo make this pointers instead of field names.
        return this.compiledSchema.then(validator =>
            this.mapValidationResult(
                //validator(value, this.schema.getPropertyPointer(propertyName)) as boolean,
                this.validator.validate(this.schema.fields[propertyName], value),
                this.validator.errors));
    }

    /**
     * Validate entity patch operations according to the schema.
     *
     * @param ops The operations that have to be validated according to the json schema.
     *
     * @return The result of the validation.
     */
    public validatePatchOperations<T>(ops: JsonPatchOperation[]): Promise<ValidationResult> {
        //@todo validate dis
        return Promise.reject('Operation not supported.');
    }

    /**
     * Maps the AJV specific error structs to lbrary cmpatible structs.
     */
    protected mapValidationResult(valid: boolean, errors: ajv.ErrorObject[]): ValidationResult {
        return {
            valid,
            errors: _.map(errors, e => ({
                code: e.keyword,
                message: e.message,
                params: e.params,
                description: e.message,
                path: e.dataPath
            } as ValidationError))
        } as ValidationResult;
    }

    /**
     * Takes an schema reference and resolves it to a schema.
     *
     * @param ref The reference to resolve.
     *
     * @return A promise for an JsonSchema.
     */
    protected resolveMissingSchemaReference(ref: string): Promise<JsonSchema> {
        if (!!this.cache) {
            let schema = this.cache.getSchema(ref);
            if (!!schema) {
                return Promise.resolve(schema);
            }
        }

        if (!!this.fetcher) {
            return this.fetcher.fetchSchema(ref).then(schema => {
                if (!!this.cache) {
                    try {
                        this.cache.setSchema(schema);
                    }
                    catch(e) {
                        debug(`Succesfully fetched the schema ${ref}, but could not store it in the cache.`);
                    }
                }
                return schema;
            });
        }

        return Promise.reject(new Error(`Unable to find the requested schema "${ref}"`));
    }

    /**
     * Register custom format.
     *
     * @param name The name of the format.
     * @param format The format validation function.
     */
    public static registerFormat(name: string, format: (str: string) => boolean): void {
        AjvSchemaValidator.formats[name] = format;
    }
}
