import { JsonSchema } from '../models/schema';
import { ISchemaCache } from './schema-cache';

/**
 * Schema caching service for fetched schema's.
 */
export class MemorySchemaCache implements ISchemaCache {
    /**
     * Schemas that have been cached in the current session.
     */
    private schemas: { [id: string]: JsonSchema } = { };

    /**
     * Get a json-schema by id.
     *
     * @param id Schema id of the referenced schema.
     *
     * @return string
     */
    public getSchema(id: string): JsonSchema {
        return this.schemas[id];
    }

    /**
     * Add/set a schema in the cache.
     *
     * @param schema The JsonSchema to add to the cache.
     */
    public setSchema(schema: JsonSchema): void {
        if (schema == null || schema.id == null) {
            throw new Error(`MemorySchemaCache.setSchema: Cannot cache the given schema; the schema or it's id is not set.`);
        }
        this.schemas[schema.id] = schema;
    }

    /**
     * Get a schema by a predicate.
     *
     * @param predicate The predicate that will decide whether the given schema, is the schema you need.
     *
     * @return JsonSchema
     */
    public getSchemaBy(predicate: (schema: JsonSchema) => boolean): JsonSchema {
        for (var schema in this.schemas) {
            if (this.schemas.hasOwnProperty(schema) && predicate(this.schemas[schema])) {
                return this.schemas[schema];
            }
        }
        return null;
    }

    /**
     * Iterate over every schema in the cache.
     *
     * Heavy operation, should be avoided at all cost.
     *
     * @param predicate The operation that should be executed for every schema in the cache.
     */
    public each(predicate: (schema: JsonSchema) => void): void {
        for (var schema in this.schemas) {
            if (this.schemas.hasOwnProperty(schema)) {
                predicate(this.schemas[schema]);
            }
        }
    }
}
