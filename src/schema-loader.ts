import { SchemaNavigator } from './schema-navigator';
import { ISchemaCache } from './schema-cache';

/**
 * Schema interpreater and "hyper/media-link" executor.
 * 
 * This class makes it possible to read a json-schema and load the links that are defined in it.
 * Makes it easy to use the links used in json-schemas as outlined in the () JSON-Schema Hyper schema extension.
 */
export class SchemaLoader {
    /**
     * Construct a new schema loader using a SchemaNvaigator.
     * 
     * @param schema 
     */
    public constructor(
        private schema: Promise<SchemaNavigator>,
        private cache: ISchemaCache,

    ) {

    }
}
