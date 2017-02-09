import { Buffer } from 'buffer';

import { IAgentAuthenticator } from './agent-authenticator';
import { HeaderDictionary } from '../agents/schema-agent';

/**
 * Authenticate an agent with basic-authentication username-password combinations.
 */
export class BasicAgentAuthenticator implements IAgentAuthenticator {
    /**
     * @param username Username to send as part of the basic auth authentication.
     * @param password Password to send as part of the basic auth authentication.
     */
    public constructor(
        public username: string,
        public password: string
    ) { }

    /**
     * Authenticate a request with the currently set JWT token.
     */
    public authenticateRequest(headers: HeaderDictionary): HeaderDictionary {
        if (this.username != null && this.username !== '') {
            let buffer = new Buffer(this.username + ':' + this.password, 'binary');
            headers['Authorization'] = 'Basic ' + buffer.toString('base64');
        }

        return headers;
    }
}
