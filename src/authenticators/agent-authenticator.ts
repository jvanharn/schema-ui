import { HeaderDictionary } from '../agents/schema-agent';

/**
 * Interface that when implemented makes it possible for an agent to make authenticated requests.
 */
export interface IAgentAuthenticator {
    /**
     * Authenticates a request.
     *
     * @param currentHeaders The currently set.
     *
     * @return The modified headers that can authenticate the request.
     */
    authenticateRequest(currentHeaders: HeaderDictionary): HeaderDictionary;
}


