import { JsonSchema } from './schema';

/**
 * Common JSON Schema extensions shared between the Form and Table extensions.
 */
export interface CommonJsonSchema extends JsonSchema {
    /**
     * Entity name of the described document.
     */
    entity?:string;
}
