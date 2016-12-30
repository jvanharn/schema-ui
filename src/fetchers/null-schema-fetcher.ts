import { JsonSchema } from '../models/schema';
import { ISchemaFetcher } from './schema-fetcher';

/**
 * No-op schema fetcher.
 *
 * This schema fetcher always rejects the schema-requests.
 */
export class NullSchemaFetcher implements ISchemaFetcher {
    /**
     * Fetch the given schema by it's identifier.
     *
     * @param id The schema identifier for the schema to retrieve.
     *
     * @return A promise that rejects.
     */
    public fetchSchema(id: string): Promise<JsonSchema> {
        return Promise.reject('NullSchemaFetcher always resolves false.');
    }
}
