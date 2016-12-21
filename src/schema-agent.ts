import { SchemaNavigator } from './schema-navigator';
import { ISchemaCache } from './cache/schema-cache';
import { ISchemaFetcher } from './fetchers/schema-fetcher';

//@todo replace z-schema with a custom implementation in typescript.
import zschema = require('z-schema');

/**
 * Schema interpreter and "hyper/media-link" agent.
 *
 * This class makes it possible to read a json-schema and load the links that are defined in it.
 * Makes it easy to use the links used in json-schemas as outlined in the JSON-Schema Hyper schema extension.
 */
export class SchemaAgent {
    /**
     * Parent schema for this agent.
     */
    public readonly parent: SchemaAgent;

    /**
     * Path prefix for properties in this schema.
     */
    public path: string = '/';

    /**
     * The Schema validator.
     */
    private _validator: ZSchema.Validator;

    /**
     * Construct a new schema agent using a SchemaNavigator.
     *
     * @param schema The schema-navigator used to easily extract link information from the schema.
     * @param cache The schema cache to use to fetch schema's not currently known to the agent.
     * @param fetcher The fetcher to enable us to fetch schema's that are currently not available.
     */
    public constructor(
        private schema: SchemaNavigator,
        private cache: ISchemaCache,
        private fetcher: ISchemaFetcher
    ) {
        this._validator = new zschema({
            noExtraKeywords: false,
            breakOnFirstError: false
        });
    }


}
