import { ISchemaFetcher } from './schema-fetcher';
import { IAgentAuthenticator } from '../authenticators/agent-authenticator';

/**
 * Authenticable schema fetcher.
 */
export interface IAuthenticatedSchemaFetcher extends ISchemaFetcher {
    /**
     * Authenticator to be able to authenticate requests with.
     */
    authenticator?: IAgentAuthenticator;
}
