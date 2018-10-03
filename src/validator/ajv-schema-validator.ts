import { Ajv, ValidateFunction, Options as AjvOptions } from 'ajv';

import { JsonSchema, JsonFormSchema, JsonPatchOperation } from '../models/index';
import { SchemaNavigator } from '../navigator/schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';

import { CommonFormats } from './common-formats';
import { ISchemaValidator, ICompiledSchemaValidator, ValidationError, ValidationResult } from './schema-validator';
import { fixJsonPointerPath } from '../index';

import * as ajv from 'ajv';
import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:validator:ajv');

/**
 * Class that helps with the validation of a schema or it's properties.
 */
export class AjvSchemaValidator implements ICompiledSchemaValidator, ISchemaValidator {
    /**
     * Formats globally registered.
     */
    protected static formats: { [name: string]: (str: string) => boolean } = { };

    /**
     * The Schema validator.
     */
    protected validator: Ajv;

    /**
     * The compiled main schema.
     */
    protected compiledSchema: Promise<ValidateFunction>;

    /**
     * The last executed action, so we never run parralel operations on the same compiled schema instance.
     */
    protected lastAsyncAction: Promise<any>;

    /**
     * @param schema Schema to validate with.
     * @param cache The cache to fetch any missing schema references with.
     * @param fetcher The fetcher to fetch schemas missing from the cache from.
     */
    public constructor(
        public readonly schema: SchemaNavigator,
        protected readonly cache?: ISchemaCache,
        protected readonly fetcher?: ISchemaFetcher,
        options?: AjvOptions
    ) {
        debug(`initialized AJV Schema Validator for schema.$id "${schema.original.id || schema.schemaId}"`);

        this.validator = new ajv(
            _.assign({
                schemaId: 'auto',
                formats: _.assign({}, CommonFormats, AjvSchemaValidator.formats),
                inlineRefs: false,
                loadSchema: (uri: string): Promise<any> =>
                    this.resolveMissingSchemaReference(uri)
                        .catch(err => {
                            debug('[warn] something went wrong trying to resolve a missing schema reference: ' + uri, err);
                            return false;
                        }),
            } as AjvOptions, options));

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

        // Support draft 04 schemas
        this.validator.addMetaSchema({
            "id": "http://json-schema.org/draft-04/schema#",
            "$schema": "http://json-schema.org/draft-04/schema#",
            "description": "Core schema meta-schema",
            "definitions": {
                "schemaArray": {
                    "type": "array",
                    "minItems": 1,
                    "items": { "$ref": "#" }
                },
                "positiveInteger": {
                    "type": "integer",
                    "minimum": 0
                },
                "positiveIntegerDefault0": {
                    "allOf": [ { "$ref": "#/definitions/positiveInteger" }, { "default": 0 } ]
                },
                "simpleTypes": {
                    "enum": [ "array", "boolean", "integer", "null", "number", "object", "string" ]
                },
                "stringArray": {
                    "type": "array",
                    "items": { "type": "string" },
                    "minItems": 1,
                    "uniqueItems": true
                }
            },
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "format": "uri"
                },
                "$schema": {
                    "type": "string",
                    "format": "uri"
                },
                "title": {
                    "type": "string"
                },
                "description": {
                    "type": "string"
                },
                "default": {},
                "multipleOf": {
                    "type": "number",
                    "minimum": 0,
                    "exclusiveMinimum": true
                },
                "maximum": {
                    "type": "number"
                },
                "exclusiveMaximum": {
                    "type": "boolean",
                    "default": false
                },
                "minimum": {
                    "type": "number"
                },
                "exclusiveMinimum": {
                    "type": "boolean",
                    "default": false
                },
                "maxLength": { "$ref": "#/definitions/positiveInteger" },
                "minLength": { "$ref": "#/definitions/positiveIntegerDefault0" },
                "pattern": {
                    "type": "string",
                    "format": "regex"
                },
                "additionalItems": {
                    "anyOf": [
                        { "type": "boolean" },
                        { "$ref": "#" }
                    ],
                    "default": {}
                },
                "items": {
                    "anyOf": [
                        { "$ref": "#" },
                        { "$ref": "#/definitions/schemaArray" }
                    ],
                    "default": {}
                },
                "maxItems": { "$ref": "#/definitions/positiveInteger" },
                "minItems": { "$ref": "#/definitions/positiveIntegerDefault0" },
                "uniqueItems": {
                    "type": "boolean",
                    "default": false
                },
                "maxProperties": { "$ref": "#/definitions/positiveInteger" },
                "minProperties": { "$ref": "#/definitions/positiveIntegerDefault0" },
                "required": { "$ref": "#/definitions/stringArray" },
                "additionalProperties": {
                    "anyOf": [
                        { "type": "boolean" },
                        { "$ref": "#" }
                    ],
                    "default": {}
                },
                "definitions": {
                    "type": "object",
                    "additionalProperties": { "$ref": "#" },
                    "default": {}
                },
                "properties": {
                    "type": "object",
                    "additionalProperties": { "$ref": "#" },
                    "default": {}
                },
                "patternProperties": {
                    "type": "object",
                    "additionalProperties": { "$ref": "#" },
                    "default": {}
                },
                "dependencies": {
                    "type": "object",
                    "additionalProperties": {
                        "anyOf": [
                            { "$ref": "#" },
                            { "$ref": "#/definitions/stringArray" }
                        ]
                    }
                },
                "enum": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": true
                },
                "type": {
                    "anyOf": [
                        { "$ref": "#/definitions/simpleTypes" },
                        {
                            "type": "array",
                            "items": { "$ref": "#/definitions/simpleTypes" },
                            "minItems": 1,
                            "uniqueItems": true
                        }
                    ]
                },
                "allOf": { "$ref": "#/definitions/schemaArray" },
                "anyOf": { "$ref": "#/definitions/schemaArray" },
                "oneOf": { "$ref": "#/definitions/schemaArray" },
                "not": { "$ref": "#" }
            },
            "dependencies": {
                "exclusiveMaximum": [ "maximum" ],
                "exclusiveMinimum": [ "minimum" ]
            },
            "default": {}
        });

        this.lastAsyncAction = this.compiledSchema = new Promise((resolve, reject) =>
            this.validator.compileAsync(this.schema.original)
                .then(validate => {
                    debug(`compiled ajv schema validator for schema.$id "${schema.original.id || schema.schemaId}"`);
                    resolve(validate);
                }, err => {
                    if (_.endsWith(err.message, 'already exists')) {
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
     * Promise that resolves once the schema is compiled.
     */
    public get compilation(): Promise<this> {
        return this.compiledSchema.then(() => this);
    }

    /**
     * Validate entity item instance with the entire schema.
     *
     * @param item The item that should be validated by the schema this schema-validator represents.
     *
     * @return The result of the validation.
     */
    public validate<T>(item: T): Promise<ValidationResult> {
        return this.lastAsyncAction = this.lastAsyncAction.then(() =>
            this.mapValidationResult(
                //@todo use the compiled schema and calculate the subpath (this shuould be possible with the newer json schemas)
                //validator(item, this.schema.propertyPrefix) as boolean,
                this.validator.validate(this.schema.schemaId, item) as boolean,
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
        return this.lastAsyncAction = this.lastAsyncAction.then(() =>
            this.mapValidationResult(
                //validator(value, this.schema.getPropertyPointer(propertyName)) as boolean,
                this.validator.validate(this.schema.fields[this.schema.getPropertyPointer(propertyName)], value) as boolean,
                this.validator.errors));
    }

    /**
     * Validate the field with the given pointer.
     *
     * @param pointer The JSON-Pointer of the property to validate (as an sub-schema).
     * @param value The value to validate with the schema.
     *
     * @return The result of the validation.
     */
    public validatePointer(pointer: string, value: any): Promise<ValidationResult> {
        if (pointer == null || pointer.length <= 1) {
            return Promise.reject(new Error(`Invalid field pointer given "${pointer}"`));
        }

        pointer = fixJsonPointerPath(pointer);

        return this.lastAsyncAction = this.lastAsyncAction.then(() => {
            var fieldSchemas: JsonFormSchema[];
            if (!!this.schema.fields[pointer]) {
                fieldSchemas = [this.schema.fields[pointer]];
            }
            else if (fixJsonPointerPath(this.schema.propertyPrefix) === pointer) {
                fieldSchemas = [this.schema.root as JsonFormSchema];
            }
            else {
                fieldSchemas = this.schema.getFieldDescriptorForPointer(pointer);
            }

            if (!Array.isArray(fieldSchemas) || fieldSchemas.length === 0) {
                debug(`[err] The given field is not available in the SchemaNavigator registry, so I could not find it's schema! I did not validate the schema!`);
                return {
                    valid: false,
                    errors: [{
                        code: 'NO_SCHEMA_FOUND',
                        message: `Couldnt validate this field, because I could not find an schema for the pointer "${pointer}"!`,
                        params: { pointer },
                        description: `Couldnt validate this field, because I could not find an schema for the pointer "${pointer}"!`,
                        path: pointer
                    } as ValidationError]
                } as ValidationResult;
            }

            return Promise.all(fieldSchemas.map(x => this.validator.validate(x, value)))
                .then(results => this.mapValidationResult(_.every(results), this.validator.errors));
        });
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
                path: String(e.dataPath).replace('[\'', '/').replace('\'].', '/').replace('.', '/'),
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
        if (!ref.endsWith('#')) {
            ref = ref + '#';
        }

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
