import { ISchemaAgent } from './schema-agent';
import { IAgentAuthenticator } from '../authenticators/agent-authenticator';

/**
 * Authenticable schema agent.
 */
export interface IAuthenticatedSchemaAgent extends ISchemaAgent {
    /**
     * Authenticator to be able to authenticate requests with.
     */
    authenticator: IAgentAuthenticator;
}
