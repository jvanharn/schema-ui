import { JsonSchema } from '../models/schema';

/**
 * Schema caching service interface.
 *
 * Classes implementing this interface
 */
export interface ISchemaCache {
    /**
     * Get a json-schema by id.
     *
     * @param id Schema id of the referenced schema.
     *
     * @return string
     */
    getSchema(id: string): JsonSchema;

    /**
     * Add/set a schema in the cache.
     *
     * @param schema The JsonSchema to add to the cache.
     */
    setSchema(schema: JsonSchema): void;

    /**
     * Remove a schema from the cache.
     *
     * @param id Schema id of the schema to delete.
     */
    removeSchema(id: string): void;

    /**
     * Get a schema by a predicate.
     *
     * Heavy operation, should be avoided at all cost.
     *
     * @param predicate The predicate that will decide whether the given schema, is the schema you need.
     *
     * @return JsonSchema
     */
    getSchemaBy(predicate: (schema: JsonSchema) => boolean): JsonSchema;

    /**
     * Iterate over every schema in the cache.
     *
     * Heavy operation, should be avoided at all cost.
     *
     * @param predicate The operation that should be executed for every schema in the cache.
     */
    each(predicate: (schema: JsonSchema) => void): void;
}
