import { JsonSchema, CommonJsonSchema, JsonPatchOperation } from '../models/index';
import { SchemaNavigator } from '../schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';

import { CommonFormats } from './common-formats';

import * as ajv from 'ajv';
import * as _ from 'lodash';
import * as pointer from 'json-pointer';

/**
 * Interface that helps with the validation of a schema or it's properties.
 */
export interface ISchemaValidator {
    /**
     * Schema navigator.
     */
    schema: SchemaNavigator;

    /**
     * Validate entity item instance with the entire schema.
     *
     * @param item The item that should be validated by the schema this schema-validator represents.
     *
     * @return The result of the validation.
     */
    validate<T>(item: T): Promise<ValidationResult>;

    /**
     * Validate the property with the given name.
     *
     * @param propertyName The name of the property to validate (as an sub-schema).
     * @param value The value to validate with the schema.
     *
     * @return The result of the validation.
     */
    validateProperty(propertyName: string, value: any): Promise<ValidationResult>;

    /**
     * Validate entity patch operations according to the schema.
     *
     * @param ops The operations that have to be validated according to the json schema.
     *
     * @return The result of the validation.
     */
    validatePatchOperations<T>(ops: JsonPatchOperation[]): Promise<ValidationResult>;
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
