import { JsonSchema } from '../models';
import { ISchemaValidator } from './schema-validator';
import { SchemaNavigator } from '../navigator/schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { AjvSchemaValidator } from './ajv-schema-validator';

import * as _ from 'lodash';

/**
 * Cache that caches and makes available schema validators.
 */
export class ValidatorCache {
    /**
     * Cache of schemas.
     */
    private validators: { [hash: string]: Promise<ISchemaValidator> } = { };

    /**
     * @param validatorGenerator A function that generates a new validator function for a schema, if it does not already have one cached.
     */
    public constructor(
        protected validatorGenerator: (schema: SchemaNavigator) => Promise<ISchemaValidator>
    ) { }

    /**
     * Get a validator.
     *
     * @param schema The schema to get a validator for.
     */
    public getValidator(schema: SchemaNavigator): Promise<ISchemaValidator> {
        var hash = this.generateSchemaNavigatorHash(schema);
        if (this.validators[hash]) {
            return this.validators[hash];
        }

        // Check whether there is a parent that we need to wait for.
        var chain: Promise<any> = Promise.resolve();
        for (let vhash in this.validators) {
            if (this.isParentSchemaOf(vhash, schema.original.id)) {
                chain = chain.then(() => this.validators[vhash]);
            }
        }

        // Return the safe validator.
        return this.validators[hash] = chain.then(() => this.validatorGenerator(schema));
    }

    /**
     * Method to generate a stable hash of a schema navigator.
     *
     * @param schema Schema navigator.
     */
    private generateSchemaNavigatorHash(schema: SchemaNavigator): string {
        return schema.schemaId + schema.propertyPrefix;
    }

    /**
     * Check whether the given schema id is a parent of the given child.
     *
     * @param parent Hash of the possible parent schema validator.
     * @param childSchemaId The schema id of the child.
     */
    private isParentSchemaOf(parent: string, childSchemaId: string): boolean {
        return _.startsWith(parent, childSchemaId);
    }
}

/**
 * Helper method that creates a validator cache for AJV. Usefull as a fallback/default.
 *
 * @param cache Cache used to resolve missing child schemas.
 * @param fetcher Fetcher used to fetch missing, unfetched schemas.
 */
export function createAjvValidatorCache(cache: ISchemaCache, fetcher: ISchemaFetcher): ValidatorCache {
    return new ValidatorCache(schema => (new AjvSchemaValidator(schema, cache, fetcher)).compilation);
}
