import { JsonSchema } from '../models/schema';

/**
 * Schema retrieval interface.
 *
 * Interface that makes it possible to request an schema from the original endpoint it should be taken from, by id.
 */
export interface ISchemaFetcher {
    /**
     * Fetch the given schema by it's identifier.
     *
     * @param id The schema identifier for the schema to retrieve.
     *
     * @return A promise that resolves to the requested schema, or is rejected if it was not found.
     */
    fetchSchema(id: string): Promise<JsonSchema>;
}
