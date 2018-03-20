import { fromByteArray } from 'base64-js';

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
            const encodable = this.username + ':' + this.password;
            const encoded = fromByteArray(new Uint8Array(encodable.split('').map(chr => chr.charCodeAt(0))));
            headers['Authorization'] = 'Basic ' + encoded;
        }

        return headers;
    }
}
