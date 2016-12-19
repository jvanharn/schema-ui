import { JsonSchema } from './models/schema';

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
     * Get a schema by a predicate.
     *
     * @param predicate The predicate that will decide whether the given schema, is the schema you need.
     *
     * @return JsonSchema
     */
    getSchemaBy(predicate: (schema: JsonSchema) => boolean): JsonSchema;
}
