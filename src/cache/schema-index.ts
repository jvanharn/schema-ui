import * as pointer from 'json-pointer';

import { ISchemaCache } from './schema-cache';
import { JsonSchema } from '../models/schema';

/**
 * Makes the retrieval of schema's by identity faster by creating an index of schema identities.
 *
 * Works with any other ISchemaCache implementation. (Just make sure you don't loop the instances).
 */
export class SchemaIndex implements ISchemaCache {
    /**
     * An index that resolves an nested identity to the actual identity it can be found inside.
     *
     * Tuple:
     *  - 0: Identity of the schema to find it in.
     *  - 1: JsonPointer that points to the schema's location.
     */
    protected index: { [identity: string]: [string, string] } = {};

    /**
     * @param cache The actual caching implementation to wrap. Will be iterated on construction of the index.
     */
    public constructor(
        protected readonly cache: ISchemaCache
    ) {
        // Create an index for every schema already in the cache.
        this.cache.each(s => this.fillIndexForSchema(s));
    }

//region ISchemaCache Implementation
    /**
     * @inherit
     */
    public getSchema(id: string): JsonSchema {
        // Check the index.
        if (!!this.index[id]) {
            return pointer.get(this.cache.getSchema(this.index[id][0]), this.index[id][1]);
        }

        // No index entry, regular fetch.
        return this.cache.getSchema(id);
    }

    /**
     * @inherit
     */
    public setSchema(schema: JsonSchema): void {
        this.cache.setSchema(schema);
        this.fillIndexForSchema(schema);
    }

    /**
     * @inherit
     */
    public getSchemaBy(predicate: (schema: JsonSchema) => boolean): JsonSchema {
        return this.cache.getSchemaBy(predicate);
    }

    /**
     * @inherit
     */
    public each(predicate: (schema: JsonSchema) => void): void {
        this.cache.each(predicate);
    }
//endregion

    /**
     * Analyses the JsonSchema and fills the index accordingly.
     *
     * @param schema The JSON Schema to analyse.
     * @param schemaId Schema identity of the original schema.
     * @param baseId The schema Url with an hastag and nothing after that.
     * @param prefix The JSON Pointer to prefix before schema pointers.
     */
    private fillIndexForSchema(schema: JsonSchema, schemaId?: string, baseId?: string, prefix: string = '/'): void {
        if (schemaId == null) {
            schemaId = String(schema.id);
        }

        if (baseId == null) {
            baseId = schemaId.substring(0, schemaId.lastIndexOf('#') + 1);
        }

        // Checkout the definitions, if available.
        if (!!schema.definitions) {
            for (let name in schema.definitions) {
                if (Object.prototype.hasOwnProperty.call(schema.definitions, name)) {
                    let pointer = prefix + 'definitions/' + name;

                    // Add an index entry for the path with the name of the definition
                    this.index[baseId + pointer] = [schemaId, pointer];

                    // Add an index entry, if the subschema has an id
                    if (!!schema.definitions[name].id) {
                        this.index[schema.definitions[name].id] = [schemaId, pointer];
                    }

                    // Checkout the children.
                    this.fillIndexForSchema(schema.definitions[name], schemaId, baseId, pointer + '/');
                }
            }
        }

        // Checkout the properties if the schema is an object.
        //@todo The schema is not clear about giving properties id's should also work..
        //@todo If so, implement here.

        // Checkout the items if the schema is an array.
        //@todo same as above.
    }
}