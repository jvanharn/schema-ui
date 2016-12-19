import { SchemaNavigator } from './schema-navigator';
import { ISchemaCache } from './schema-cache';

/**
 * Schema interpreter and "hyper/media-link" agent.
 *
 * This class makes it possible to read a json-schema and load the links that are defined in it.
 * Makes it easy to use the links used in json-schemas as outlined in the JSON-Schema Hyper schema extension.
 */
export class SchemaAgent {
    /**
     * Construct a new schema agent using a SchemaNavigator.
     *
     * @param schema The schema-navigator used to easily extract link information from the schema.
     * @param cache The schema cache to use to fetch schema's not currently known to the agent.
     */
    public constructor(
        private schema: SchemaNavigator,
        private cache: ISchemaCache,
    ) {

    }

//region Schema Fetching
    /**
     * Standardized method to fetch the JsonSchema from the remote server.
     */
    public fetchSchema(url: string): Promise<JsonSchema> {

    }

    /**
     *
     */
    public fetchSchemaById(id: string): Promise<JsonSchema> {

    }
//endregion
}
