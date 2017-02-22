import { JsonSchema, CommonJsonSchema, JsonPatchOperation } from '../models/index';
import { SchemaNavigator } from '../schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';

import { CommonFormats } from './common-formats';
import { ISchemaValidator, ValidationError, ValidationResult } from './schema-validator';

import * as ajv from 'ajv';
import * as _ from 'lodash';
import * as pointer from 'json-pointer';

/**
 * Class that helps with the validation of a schema or it's properties.
 */
export class AjvSchemaValidator implements ISchemaValidator {
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
        this.validator = new ajv(
            _.assign({
                formats: CommonFormats,
                loadSchema: (uri: string, cb: (err: Error, schema: Object) => any) =>
                    this.resolveMissingSchemaReference(uri)
                        .then(x => cb(null, x))
                        .catch(e => cb(e, null))
            } as ajv.Options, options));
        this.validator.addKeyword('field', {
            errors: false,
            metaSchema: {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string"
                    },
                    "visible": {
                        "type": "boolean"
                    },
                    "data": {
                        "type": "object"
                    },
                    "link": {
                        "oneOf": [
                            { "type": "string" },
                            { "type": "integer" }
                        ]
                    },
                    "targetIdentity": {
                        "type": "string"
                    }
                }
            }
        } as any);
    }

    /**
     * Validate entity item instance with the entire schema.
     *
     * @param item The item that should be validated by the schema this schema-validator represents.
     *
     * @return The result of the validation.
     */
    public validate<T>(item: T): Promise<ValidationResult> {
        if (!this.compiledSchema) {
            this.compiledSchema = new Promise((resolve, reject) =>
                this.validator.compileAsync(this.schema.root, (err, validate) => {
                    if (err != null) {
                        return reject(err);
                    }
                    resolve(validate);
                }));
        }
        return this.compiledSchema.then(validator =>
            (validator(item) as ajv.Thenable<boolean>).then(valid => this.mapValidationResult(valid, validator.errors)));
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
        return this.compiledSchema.then(validator =>
            (validator(value, this.schema.getPropertyPointer(propertyName)) as ajv.Thenable<boolean>).then(valid => this.mapValidationResult(valid, validator.errors)));
    }

    /**
     * Validate entity patch operations according to the schema.
     *
     * @param ops The operations that have to be validated according to the json schema.
     *
     * @return The result of the validation.
     */
    public validatePatchOperations<T>(ops: JsonPatchOperation[]): Promise<ValidationResult> {
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
        if () {

        }
    }
}
