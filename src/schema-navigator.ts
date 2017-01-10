import * as _ from 'lodash';
import * as pointer from 'json-pointer';
import schema = require('z-schema');

import {
    JsonSchema,
    JsonFormSchema,
    JsonTableSchema,
    CommonJsonSchema,

    SchemaHyperlinkDescriptor,
    SchemaColumnDescriptor
} from './models/index';

/**
 * Helper object for retrieving information from json-schema's.
 */
export class SchemaNavigator {
    /**
     * Construct a new schema navigator.
     * @param schema The schema to wrap as navigable.
     * @param propertyPrefix The json-pointer prefix of this jsonschema when fetching property values from objects/values/... that are validated by this schema.
     * @param schemaRootPrefix The json-pointer prefix of what value path should be considered the 'root' "properties" object containing the properties for listing fields (for JsonFormSchemas).
     */
    public constructor(
        private readonly schema: JsonSchema | JsonFormSchema | JsonTableSchema,
        private propertyPrefix: string = '/',
        private schemaRootPrefix?: string
    ) {
        // Fix the property prefix
        this.propertyPrefix = fixJsonPointerPath(propertyPrefix);

        // Determine the schemaRootPrefix
        if (this.schemaRootPrefix != null && this.schemaRootPrefix.length > 0) {
            this.schemaRootPrefix = fixJsonPointerPath(propertyPrefix);
        }
        else {
            this.schemaRootPrefix = this.guessSchemaRootPrefix();
        }
    }

    /**
     * Document identity property.
     * 
     * The "highest rated" identity property in the document. If none is found, just gives the first property in the document.
     */
    public get identityProperty(): string {
        let fields = this.propertyRoot,
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
        let props = this.propertyRoot,
            identities: string[] = [];
        for (let key in props) {
            if (props.hasOwnProperty(key) && this.isIdentityProperty(key) > 0) {
                identities.push(key);
            }
        }
        return identities;
    }

    /**
     * Finds the root property that contains one or more identity properties, or contains fields.
     *
     * Usefull for schemas that are embedded in sub-properties like "item", "items", "{entity}" or ones that also emit meta data at the root level.
     */
    public get root(): JsonSchema | JsonFormSchema | JsonTableSchema {
        return pointer.get(this.schema, this.schemaRootPrefix);
    }

    

//region CommonJsonSchema Helpers
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
//endregion

//region JsonFormSchema Helpers
    /**
     * Get all schema properties.
     * 
     * @return Dictionary of property names and their JsonSchemas.
     */
    public get propertyRoot(): { [property: string]: JsonSchema } {
        if (this.hasPatternProperties()) {
            // Cannot handle patternProperties.
            //@todo debug this to a console of sorts.
            return { };
        }
        else if (this.schema.type === 'object') {
            return this.root.properties;
        }
        else if (this.schema.type) {
            return (this.root.items as JsonSchema).properties;
        }
        else {
            return this.root.properties || { };
        }
    }

    /**
     * Check whether or not this is a form schema.
     * 
     * An schema can be both a collection/table and a form.
     */
    public isForm(): boolean {
        return !_.isEmpty(this.propertyRoot);
    }

    /**
     * Finds the main form property list and returns the ones that qualify as visible fields.
     * 
     * @return An dictionary of all visible fields in thi JsonFormSchema.
     */
    public get fields(): { [property: string]: JsonSchema } {
        let props = this.propertyRoot,
            fields: { [property: string]: JsonSchema } = {};
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
//endregion

//region JsonTableSchema Helpers
    /**
     * Check whether or not this schema is a schema for a paginated collection (e.g. a JsonTableSchema).
     * 
     * An schema can be both a collection/table and a form.
     */
    public isCollection(): boolean {
        return !!(this.schema as JsonTableSchema).columns && _.isArray((this.schema as JsonTableSchema).columns);
    }

    /**
     * Get the list of columns associated with this schema.
     */
    public get columns(): SchemaColumnDescriptor[] {
        return _.isArray((this.schema as JsonTableSchema).columns)
            ? (this.schema as JsonTableSchema).columns
            : new Array;
    }
//endregion

//region Json Hyperschema Helpers
    /**
     * Get all schema hyperlinks.
     */
    public get links(): SchemaHyperlinkDescriptor[] {
        return _.isArray(this.schema.links)
            ? this.schema.links
            : new Array;
    }
//endregion

    /**
     * Whether or not the schema has patterned properties in it's root.
     */
    public hasPatternProperties(): boolean {
        return (!!this.root.patternProperties && _.size(this.root.patternProperties) > 0);
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
     * Method to guess the schema root prefix.
     */
    private guessSchemaRootPrefix(): string {
        var objectKey: string;

        // Check if the schema itself is an array.
        if (this.schema.type === 'array' && !!this.schema.items && _.isObject(this.schema.items) && (this.schema.items as JsonSchema).type === 'object') {
            return '/items/';
        }

        // Check if one of the common collection wrappers is used (data or items) containing a single schema item.
        else if (
            this.schema.type === 'object' && !!this.schema.properties && _.isObject(this.schema.properties) && _.size(this.schema.properties) < 3 &&
            !!(objectKey = _.findKey(this.schema.properties, (v, k) => k.toLowerCase() === 'data' || k.toLowerCase() === 'items'))
        ) {
            if (this.schema.properties[objectKey].type === 'array') {
                return ` /properties/${objectKey}/items/`;
            }
            else if(this.schema.properties[objectKey].type === 'object') {
                return ` /properties/${objectKey}/`;
            }
        }

        // Just assume the root is ok.
        return '/';
    }
}

/**
 * Fixes common mistakes in JsonPointers.
 */
function fixJsonPointerPath(path: string): string {
    if (path[0] !== '/' && path[0] !== '$') {
        path = '/' + path;
    }
    if (path[path.length - 1] !== '/') {
        path += '/';
    }
    return path;
}
