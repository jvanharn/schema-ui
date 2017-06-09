import { JsonSchema } from '../models';
import { ISchemaValidator } from './schema-validator';
import { SchemaNavigator } from '../navigator/schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { AjvSchemaValidator } from './ajv-schema-validator';

/**
 * Cache that caches and makes available schema validators.
 */
export class ValidatorCache {
    /**
     * Cache of schemas.
     */
    private validators: { [hash: string]: ISchemaValidator } = { };

    /**
     * @param cache Cache used to resolve missing child schemas.
     * @param fetcher Fetcher used to fetch missing, unfetched schemas.
     * @param validatorGenerator A function that generates a new validator function for a schema, if it does not already have one cached.
     */
    public constructor(
        cache: ISchemaCache,
        fetcher: ISchemaFetcher,
        protected validatorGenerator: (schema: SchemaNavigator) => ISchemaValidator
            = schema => new AjvSchemaValidator(schema, cache, fetcher)
    ) { }

    /**
     * Get a validator.
     */
    public getValidator(schema: SchemaNavigator): ISchemaValidator {
        var hash = this.generateSchemaNavigatorHash(schema);
        if (this.validators[hash]) {
            return this.validators[hash];
        }

        return this.validators[hash] = this.validatorGenerator(schema);
    }

    /**
     * Method to generate a stable hash of a schema navigator.
     *
     * @param schema Schema navigator.
     */
    private generateSchemaNavigatorHash(schema: SchemaNavigator): string {
        return schema.schemaId + schema.propertyPrefix;
    }
}
