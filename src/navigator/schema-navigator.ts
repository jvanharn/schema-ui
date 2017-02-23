import * as _ from 'lodash';
import * as pointer from 'json-pointer';

import * as debuglib from 'debug';
var debug = debuglib('schema:navigator');

import {
    JsonSchema,
    JsonFormSchema,
    JsonTableSchema,
    CommonJsonSchema,
    SchemaPropertyMap,

    IdentityValue,
    IdentityValues,

    SchemaHyperlinkDescriptor,
    SchemaColumnDescriptor
} from './models/index';

/**
 * Helper object for retrieving information from json-schema's.
 */
export class SchemaNavigator {
    /**
     * Cache where a list of resolved schemaids to properties is saved into.
     */
    protected schemaIdPointerMap: { [schemaId: string]: string };

    /**
     * Cache where a list of propertyRoot properties is mapped to their schema json pointers.
     */
    protected propertyRootSchemaPointerMap: { [property: string]: string };

    /**
     * Construct a new schema navigator.
     * @param schema The schema to wrap as navigable.
     * @param propertyPrefix The json-pointer prefix of this jsonschema when fetching property values from objects/values/... that are validated by this schema.
     * @param schemaRootPrefix The json-pointer prefix of what value path should be considered the 'root' "properties" object containing the properties for listing fields (for JsonFormSchemas).
     */
    public constructor(
        protected readonly schema: JsonSchema | JsonFormSchema | JsonTableSchema,
        public propertyPrefix: string = '/',
        public readonly schemaRootPrefix?: string
    ) {
        if (this.schema == null) {
            debug('[warn] tried to create navigable-schema with empty schema');
            throw new Error('Cannot make a null schema navigable, the schema property is required.');
        }

        // Fix the property prefix
        this.propertyPrefix = fixJsonPointerPath(propertyPrefix, true);

        // Determine the schemaRootPrefix
        if (this.schemaRootPrefix != null && this.schemaRootPrefix.length > 0) {
            this.schemaRootPrefix = fixJsonPointerPath(propertyPrefix, true);
        }
        else {
            this.schemaRootPrefix = this.guessSchemaRootPrefix();
        }

        // Make sure this schema has an id set (otherwise we wont accept it)
        if (this.schemaId == null) {
            throw new Error('Schema\'s without an identity are not allowed. If you want to use an sub-schema, please use the schemaRootPrefix property instead.');
        }
    }

    /**
     * Get the identifier of the underlying schema.
     */
    public get schemaId(): string {
        return this.root.id || this.schema.id;
    }

    /**
     * Get the underlying/wrapped schema.
     */
    public get original(): Readonly<JsonSchema> {
        return this.schema;
    }

    /**
     * Document identity property.
     *
     * The "highest rated" identity property in the document. If none is found, just gives the first property in the document.
     */
    public get identityProperty(): string {
        let fields = this.propertyRoot,
            name: string,
            current: number;

        for (var key in fields) {
            var score = this.isIdentityProperty(key);
            if (!name) {
                name = key;
                current = Math.min(score, 3);
            }
            else if (fields.hasOwnProperty(key) && score > 0 && score < current) {
                if (score === 1) {
                    return key;
                }
                name = key;
                current = score;
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
        if (this.schemaRootPrefix === '/' || this.schemaRootPrefix.length <= 1) {
            return this.schema;
        }

        try {
            return pointer.get(this.schema, this.schemaRootPrefix);
        }
        catch (e) {
            debug('error when retrieving root', e);
            return this.schema;
        }
    }

//region CommonJsonSchema Helpers
    /**
     * The name of the entity that this schema describes.
     *
     * When not set, the entity name is guessed based on the schema id.
     * @throws Error When the schema id and entity name are not set.
     */
    public get entity(): string | null {
        return SchemaNavigator.getSchemaEntity(this.schema);
    }
//endregion

//region JsonFormSchema Helpers
    /**
     * Property containing the cached pattern property root.
     */
    private _patternPropertyRootCache: SchemaPropertyMap<JsonSchema>;

    /**
     * Property containing the cached pattern property root.
     */
    private _patternRequiredPropertyCache: string[];

    /**
     * Builds the cache of (required) pattern properties
     */
    private _buildPatternPropertyCache(): void {
        // begin with any regular properties, if they are set
        if (_.isPlainObject(this.root.properties) && _.size(this.root.properties) > 0) {
            this._patternPropertyRootCache = _.assign({}, this.root.properties) as SchemaPropertyMap<JsonSchema>;

            this.createPropertyRootCache(
                fixJsonPointerPath((this.schemaRootPrefix || '/') + 'properties', true),
                this.root.properties);
        }
        else {
            this._patternPropertyRootCache = { };
        }
        this._patternRequiredPropertyCache = [];

        var parts = this.propertyPrefix.split('/'),
            matchable = !!parts && !!parts[1] ? String(parts[1]) : '';
        if (matchable.length === 0) {
            debug(`[warn] propertyRoot is matching on an empty first property root path (${this.propertyPrefix}), so this will probably cause unexpected behaviour.`);
        }

        _.each(this.root.patternProperties, (schema: JsonSchema, pattern: string) => {
            if (matchable.search(pattern) >= 0) {
                this._patternPropertyRootCache = _.assign(this._patternPropertyRootCache, schema.properties) as SchemaPropertyMap<JsonSchema>;

                this.createPropertyRootCache(
                    fixJsonPointerPath((this.schemaRootPrefix || '/') + `patternProperties/${pattern}/properties`, true),
                    schema.properties);

                if (_.isArray(schema.required)) {
                    this._patternRequiredPropertyCache.push(...schema.required);
                }
            }
        });
    }

    /**
     * Get all schema properties.
     *
     * @return Dictionary of property names and their JsonSchemas.
     */
    public get propertyRoot(): SchemaPropertyMap<JsonSchema> {
        if (this.hasPatternProperties()) {
            if (this._patternPropertyRootCache == null) {
                this._buildPatternPropertyCache();
            }

            return this._patternPropertyRootCache;
        }
        else if (this.schema.type === 'object') {
            if (!this.propertyRootSchemaPointerMap) {
                this.createPropertyRootCache(
                    fixJsonPointerPath((this.schemaRootPrefix || '/') + 'properties', true),
                    this.root.properties);
            }

            return this.root.properties;
        }
        else if (this.schema.type === 'array' && !_.isArray(this.root.items as JsonSchema)) {
            if (!this.propertyRootSchemaPointerMap) {
                this.createPropertyRootCache(
                    fixJsonPointerPath((this.schemaRootPrefix || '/') + 'items/properties', true),
                    this.root.properties);
            }

            return (this.root.items as JsonSchema).properties;
        }
        else {
            return { };
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
    public get fields(): SchemaPropertyMap<JsonFormSchema> {
        let props = this.propertyRoot,
            fields: SchemaPropertyMap<JsonFormSchema> = { };
        for (let key in props) {
            if (!props.hasOwnProperty(key)) {
                continue;
            }

            let item = (props[key] as JsonFormSchema).field;
            if (!!item && (item.visible === true || (item.type != null && item.visible !== false))) {
                fields[key] = props[key] as JsonFormSchema;
            }
        }
        return fields;
    }

    /**
     * Check whether the field in this schema root is required.
     *
     * @param name The name of the field to check. Has to be returned by the fields property.
     *
     * @return Whether or not the given field is required.
     */
    public isFieldRequired(name: string): boolean {
        if (this.hasPatternProperties()) {
            if (this._patternRequiredPropertyCache == null) {
                this._buildPatternPropertyCache();
            }

            return _.includes(this._patternRequiredPropertyCache, name);
        }
        else if (this.schema.type === 'object') {
            return _.includes(this.root.required, name);
        }
        else if (this.schema.type) {
            return _.includes((this.root.items as JsonSchema).required, name);
        }
        return false;
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

    /**
     * Get a schema hyper(media)link by the relation type.
     *
     * @link https://tools.ietf.org/html/rfc5988#section-6.2.2 See this page for official 'rel' value names.
     *
     * @param rel Name or 'relation' of the hyperlink OR index of the hyperlink.
     *
     * @return The hyperlink descriptor object.
     */
    public getLink(rel: string | number): SchemaHyperlinkDescriptor {
        if (_.isString(rel)) {
            return _.find(this.links, x => x.rel === rel);
        }
        else if (_.isNumber(rel)) {
            return this.links[rel];
        }
        debug('link requested with invalid "rel" type');
        return null;
    }

    /**
     * Check whether a schema hyper(media)link by the given relation type exists.
     *
     * @link https://tools.ietf.org/html/rfc5988#section-6.2.2 See this page for official 'rel' value names.
     *
     * @param rel Name or 'relation' of the hyperlink or index of the hyperlink.
     *
     * @return Whether or not the given link exists on this schema.
     */
    public hasLink(rel: string | number): boolean {
        if (_.isString(rel)) {
            return _.some(this.links, x => x.rel === rel);
        }
        else if (_.isNumber(rel)) {
            return !!this.links[rel];
        }
        debug('link existence asked with invalid "rel" type');
        return null;
    }


    /**
     * Get a schema hyper(media)link by a ordered list of relation types.
     *
     * This method will first look for the first link, if it doesnt find it, the next, etc untill it finds one or no relation names are left.
     *
     * @link https://tools.ietf.org/html/rfc5988#section-6.2.2 See this page for official 'rel' value names.
     *
     * @param rels Relation names that should be searched for, in search order.
     *
     * @return The hyperlink descriptor object.
     */
    public getFirstLink(rels: string[]): SchemaHyperlinkDescriptor {
        let result: SchemaHyperlinkDescriptor
        for (let rel of rels) {
            result = this.getLink(rel);
            if (result != null) {
                break;
            }
        }
        return result;
    }
//endregion

//region JSON-Pointer helpers
    /**
     * Get property or field value.
     *
     * @param name The name of the property to fetch.
     * @param data The data object to fetch the property from.
     *
     * @return The value of the property or undefined if not set.
     */
    public getPropertyValue(name: string, data: any): any {
        return pointer.get(data, this.getPropertyPointer(name));
    }

    /**
     * Get the property data pointer.
     *
     * Get the JSON Pointer pointing to the given field property value in the data object described by this schema.
     *
     * @param name The name of the property to get the pointer to.
     *
     * @return The pointer to the given property value.
     */
    public getPropertyPointer(name: string): string {
        let prop = _.findKey(this.propertyRoot, (v, k) => k.toLowerCase() === name.toLowerCase())
        if (prop == null) {
            return void 0;
        }
        return fixJsonPointerPath(this.propertyPrefix + prop);
    }

    /**
     * Get the property schema pointer.
     *
     * Get the JSON Pointer pointing to the given field property schema/descriptor in this schema
     *
     * @param name The name of the property to get the pointer to.
     *
     * @return The pointer to the given property schema.
     */
    public getPropertySchemaPointer(name: string): string {
        return this.propertyRootSchemaPointerMap[String(name).toLowerCase()];
    }

    /**
     * Get the identity value for the given data.
     *
     * @param data The data to fetch the identity property value from.
     *
     * @return The identity property value.
     */
    public getIdentityValue(data: any): IdentityValue {
        return this.getPropertyValue(this.identityProperty, data);
    }

    /**
     * Get all identity property values found in the schema.
     *
     * @param data The data to fetch the identity property values from.
     *
     * @return The identity property value dictionary.
     */
    public getIdentityValues(data: any): IdentityValues {
        let result: IdentityValues = { };
        for (let prop in this.identityProperties) {
            result[prop] = this.getPropertyValue(prop, data);
        }
        return result;
    }

    /**
     * Creates a cache with properties and how to access them in the schema.
     */
    protected createPropertyRootCache(basePath: string, obj: { [key: string]: any }): void {
        if (!this.propertyRootSchemaPointerMap) {
            this.propertyRootSchemaPointerMap = { };
        }

        _.each(obj, (val, key) => {
            this.propertyRootSchemaPointerMap[key.toLowerCase()] = basePath + key;
        });
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
        if (this.schemaIdPointerMap != null) {
            return this.schemaIdPointerMap;
        }

        let result: { [id: string]: string } = { };
        this.traverseSchemaDefinitions(this.schema, (id: string, pointer: string) => {
            result[id] = pointer;
        });

        this.schemaIdPointerMap = result;
        return result;
    }

    /**
     * Get an embedded schema by the given id.
     *
     * @param schemaId The identity of the schema to retrieve.
     *
     * @return The embedded shcema or null if it was not found.
     */
    public getEmbeddedSchema(schemaId: string): JsonSchema | null {
        if (!_.isString(schemaId) || schemaId.length <= 3) {
            throw new Error('Expected the schemaId to be a string, but got something else.');
        }

        if (schemaId[0] === '#') {
            return pointer.get(this.schema, fixJsonPointerPath(schemaId.substr(1)));
        }

        let sp = this.getSchemaIdsWithPointers()[schemaId];
        if (sp == null || sp === '') {
            debug(`requested embedded schema with id ${schemaId}, but could not find it`);
            return null;
        }

        return pointer.get(this.schema, fixJsonPointerPath(sp));
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
                return `/properties/${objectKey}/items/`;
            }
            else if(this.schema.properties[objectKey].type === 'object') {
                return `/properties/${objectKey}/`;
            }
        }

        // Just assume the root is ok.
        return '/';
    }
}
