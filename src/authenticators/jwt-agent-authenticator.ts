import { IAgentAuthenticator } from './agent-authenticator';
import { HeaderDictionary } from '../agents/schema-agent';

/**
 * Authenticate an agent with an JWT token.
 */
export class JwtAgentAuthenticator implements IAgentAuthenticator {
    /**
     * @param token Token to authenticate an request with.
     */
    public constructor(public token: string) { }

    /**
     * Authenticate a request with the currently set JWT token.
     */
    public authenticateRequest(headers: HeaderDictionary): HeaderDictionary {
        if (this.token != null && this.token !== '') {
            headers['Authorization'] = 'Bearer ' + this.token;
        }

        return headers;
    }
}
