import { ISchemaAgent } from './schema-agent';
import { IdentityValues } from '../models/index';

/**
 * Schema interpreter and "hyper/media-link" agent with definable relations.
 *
 * Schema agent that can have relations defined in the parent/child sense.
 */
export interface IRelatableSchemaAgent extends ISchemaAgent {
    /**
     * Parent schema for this agent.
     */
    parent?: IRelatableSchemaAgent;

    /**
     * Get the last parent in this chain.
     */
    getRoot(): IRelatableSchemaAgent;

    /**
     * Creates a child agent for the given schema property.
     *
     * @param propertyName The name of the property to create the sub-schema for.
     * @param propertyPath The path of the property in the json structure.
     *
     * @return A promise resolving in the new sub-agent.
     */
    createChildByProperty(propertyPath: string): IRelatableSchemaAgent;
    createChildByProperty(propertyName: string): IRelatableSchemaAgent;

    /**
     * Creates child agent using the given schema reference.
     *
     * The implementation MAY check if it actually is a child/sibbling.
     *
     * @param schemaId The schema identity or schema reference of the schema that is a child of this one.
     *
     * @return A promise resolving in the new sub-agent.
     */
    createChildByReference(schemaId: string): Promise<IRelatableSchemaAgent>;

    /**
     * Creates a sibbling/related schema using the current schema's resources.
     *
     * @param linkName The name of the link to resolve the schema for.
     * @param urlData Any url/context -data to help with resolving if the agent tries to fetch the schema with an options call or similar.
     *
     * @return A promise resolving in the new sub-agent.
     */
    createChildByLink(linkName: string, urlData?: IdentityValues): Promise<IRelatableSchemaAgent>;
}
