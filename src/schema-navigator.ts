import * as _ from 'lodash';
import schema = require('z-schema');

import { JsonSchema, JsonFormSchema, JsonTableSchema, CommonJsonSchema } from './models/index';

/**
 * Helper object for retrieving information from json-schema's.
 */
export class SchemaNavigator {
    /**
     * Construct a new schema navigator.
     */
    public constructor(
        private schema: JsonSchema | JsonFormSchema | JsonTableSchema,
        private prefix: string = '/'
    ) {
        if (this.prefix[0] !== '/') {
            this.prefix = '/' + this.prefix;
        }
        if (this.prefix[this.prefix.length - 1] !== '/') {
            this.prefix += '/';
        }
    }

    /**
     * The name of the entity that this schema describes.
     *
     * When not set, the entity name is guessed based on the schema id.
     * @throws Error When the schema id and entity name are not set.
     */
    public get entity(): string {
        if (!!(this.schema as CommonJsonSchema).entity) {
            return (this.schema as CommonJsonSchema).entity;
        }
    }

    /**
     * The "highest rated" identity property in the document. If none is found, just gives the first property in the document.
     */
    public get identityProperty(): string {
        let fields = this.root,
            name: string;
        for (let key in fields) {
            let score = this.isIdentityProperty(key);
            if (!name) {
                name = key;
            }
            if (fields.hasOwnProperty(key)) {
                if (score === 1) {
                    return key;
                }
                else if (score === 2) {
                    name = key;
                }
            }
        }
        return name;
    }

    /**
     * Get's a list of all identity-like properties in the document. (Not only the main one)
     */
    public get identityProperties(): string[] {
        let props = this.root,
            identities: string[] = [];
        for (let key in props) {
            if (props.hasOwnProperty(key) && this.isIdentityProperty(key) > 0) {
                identities.push(key);
            }
        }
        return identities;
    }

    /**
     * Finds the main document, and returns an list of all visible properties.
     */
    public get fields(): { [property: string]: JsonSchema } {
        let props = this.root,
            fields: { [proeprty: string]: JsonSchema } = {};
        for (let key in props) {
            if (props.hasOwnProperty(key) &&
                (!!(props[key] as JsonFormSchema).field && (
                    (!!(props[key] as JsonFormSchema).field.type && !(props[key] as JsonFormSchema).field.visible === void 0) ||
                    (!(props[key] as JsonFormSchema).field.visible === true)
                ))
            ) {
                fields[key] = props[key];
            }
        }
        return fields;
    }

    /**
     * Finds the root property that contains one or more identity properties, or contains fields.
     *
     * Usefull for schemas that are embedded in sub-properties like "item", "items", "{entity}" or ones that also emit meta data at the root level.
     */
    public get root(): { [property: string]: JsonSchema } {
        //@todo Make this actually take stuff into cosnideration
        //@stub
        if (this.schema.type === 'object') {
            return this.schema.properties;
        }
        if (this.schema.type) {
            return (this.schema.items as JsonSchema).properties;
        }
        return null;
    }

    /**
     * Returns a map of all found id references in the schema.
     *
     * This method makes it easier to resolve embedded schemas by ids.
     */
    public getSchemaIdsWithPointers(): { [id: string]: string } {
        let result: { [id: string]: string } = { };
        this.traverseSchemaDefinitions(this.schema, (id: string, pointer: string) => {
            result[id] = pointer;
        });
        return result;
    }

    /**
     * Helper function for {@see getSchemaIdsWithPointer()}.
     */
    private traverseSchemaDefinitions(schema: JsonSchema, iterator: (id: string, pointer: string) => void, reductor: string = '/'): void {
        if (!schema.definitions) {
            return;
        }
        for (let key in schema.definitions) {
            if (schema.hasOwnProperty(key)) {
                iterator(schema.definitions[key].id, reductor);
                if (!!schema.definitions[key].definitions) {
                    this.traverseSchemaDefinitions(schema.definitions[key], iterator, reductor + key + '/');
                }
            }
        }
    }

    /**
     * Get whether the given field is an identity property.
     *
     * @return The priority of the given property as an identifying property. 0 = Not an identity, 1 = Primary identity (Numeric: ID, Id, UId, {SchemaName}Id, ...), 2 = Secondary identity (ItemId, ItemUId, ...), 3 = Composite Primary identity (String/Numeric, name, ...)
     */
    protected isIdentityProperty(name: string): 1 | 2 | 3 | 0 {
        let lower = name.toLocaleLowerCase();
        if (lower === 'id' || lower === 'uid' || lower === 'guid' || lower === `${this.entity.toLocaleLowerCase()}id`) {
            return 1;
        }
        else if (lower.indexOf('id') >= 0 || lower.indexOf('uid') >= 0 || lower.indexOf('guid') >= 0) {
            return 2;
        }
        else if (lower === 'name' || lower === 'identity' || lower === 'internalname') {
            return 3;
        }
        return 0;
    }
}
