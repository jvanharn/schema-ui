import { ISchemaAgent } from './schema-agent';
import { SchemaNavigator } from '../schema-navigator';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { SchemaValidator } from '../schema-validator';

/**
 * Schema interpreter and "hyper/media-link" agent.
 *
 * This class makes it possible to read a json-schema and load the links that are defined in it.
 * Makes it easy to use the links used in json-schemas as outlined in the JSON-Schema Hyper schema extension.
 */
export class EndpointSchemaAgent implements ISchemaAgent {
    /**
     * Parent schema for this agent.
     */
    public readonly parent: ISchemaAgent;

    /**
     * Path prefix for properties in this schema.
     */
    public path: string = '/';

    /**
     * Validate request-data before sending it to the server.
     */
    public validateRequests: boolean = true;

    /**
     * Construct a new schema agent using a SchemaNavigator.
     *
     * @param schema The schema-navigator used to easily extract link information from the schema.
     * @param cache The schema cache to use to fetch schema's not currently known to the agent.
     * @param fetcher The fetcher to enable us to fetch schema's that are currently not available.
     * @param validator The validator to help us validate incomming and outgoing requests before they are performed.
     */
    public constructor(
        private readonly schema: SchemaNavigator,
        private readonly cache: ISchemaCache,
        private readonly fetcher: ISchemaFetcher,
        private readonly validator?: SchemaValidator
    ) {
        if (validator == null) {
            this.validator = new SchemaValidator(schema, cache, fetcher);
        }
    }
}
