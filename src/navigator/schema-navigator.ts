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
    SchemaColumnDescriptor,

    SchemaTranslatableStringMap
} from '../models/index';
import {
    fixJsonPointerPath,
    getApplicablePropertyDefinitions,
    getSchemaEntity
} from './utils';

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
    protected propertyRootSchemaPointerMap: { [property: string]: string[] };

    /**
     * A list of all the definitions that apply to the given propertyPrefix.
     */
    protected readonly propertyDefinitionRoots: string[];

    /**
     * Construct a new schema navigator.
     * @param schema The schema to wrap as navigable.
     * @param propertyPrefix The json-pointer that is used to prefix the area this navigator will look in with it's methods. (Defines the schema root)
     */
    public constructor(
        protected readonly schema: JsonSchema | JsonFormSchema | JsonTableSchema,
        public readonly propertyPrefix: string = '/',
    ) {
        if (this.schema == null) {
            debug('[warn] tried to create navigable-schema with empty schema');
            throw new Error('Cannot make a null schema navigable, the schema property is required.');
        }

        // Fix the property prefix
        this.propertyPrefix = fixJsonPointerPath(propertyPrefix, true);

        // Determine the property definition root(s).
        this.propertyDefinitionRoots = getApplicablePropertyDefinitions(this.schema, this.propertyPrefix, ref => this.getEmbeddedSchema(ref));

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

    //region get/set root
        /**
         * The actual schema as calculated.
         */
        private _root: JsonSchema;

        /**
         * Finds the root property that contains one or more identity properties, or contains fields.
         *
         * Usefull for schemas that are embedded in sub-properties like "item", "items", "{entity}" or ones that also emit meta data at the root level.
         */
        public get root(): JsonSchema | JsonFormSchema | JsonTableSchema {
            if (!this._root) {
                this._root = _.assign.apply(_, _.map(this.propertyDefinitionRoots, x => {
                    try {
                        var [url, path] = x.split('#');
                        var schema = this.getEmbeddedSchema(url);
                        if (!schema) {
                            throw new Error(`Unable to find the schema id ${url}.`);
                        }

                        if (path == null || path === '/' || path === '') {
                            return schema;
                        }

                        let sub = pointer.get(schema, path);
                        if (!!sub && sub.$ref != null) {
                            sub = this.getEmbeddedSchema(sub.$ref);
                        }

                        if (!_.isObject(sub) || _.isEmpty(sub)) {
                            throw new Error('The property root contained a $ref that pointed to a non-existing(at least not embedded) schema!');
                        }

                        return sub;
                    }
                    catch (e) {
                        debug(`[warn] unable to fetch the root on path "${x}":`, e);
                        return { };
                    }
                }));

                if (!_.isObject(this._root) || _.isEmpty(this._root)) {
                    throw new Error('Unable to determine the correct property root!');
                }
            }

            return this._root;
        }
    //endregion

    //region Identity-properties
        /**
         * The property used to cache the identity once calculated.
         */
        private _identityProperty: string;

        /**
         * Document identity property.
         *
         * The "highest rated" identity property in the document. If none is found, just gives the first property in the document.
         */
        public get identityProperty(): string {
            if (!!this._identityProperty) {
                return this._identityProperty;
            }

            let fields = this.propertyRoot,
                name: string,
                current: number;

            for (var key in fields) {
                var score = this.isIdentityProperty(key);

                if (!name) {
                    name = key;
                    current = Math.min(score, 3);
                }
                else if (fields.hasOwnProperty(key) && score < current) {
                    name = key;
                    current = score;
                }

                if (score === 0) {
                    return key;
                }
            }

            return this._identityProperty = name;
        }

        /**
         * Get's a list of all identity-like properties in the document. (Not only the main one)
         */
        public get identityProperties(): string[] {
            let props = this.propertyRoot,
                identities: string[] = [];
            for (let key in props) {
                if (props.hasOwnProperty(key) && this.isIdentityProperty(key) < 4) {
                    identities.push(key);
                }
            }
            return identities;
        }
    //endregion

    //region CommonJsonSchema Helpers
        /**
         * The name of the entity that this schema describes.
         *
         * When not set, the entity name is guessed based on the schema id.
         * @throws Error When the schema id and entity name are not set.
         */
        public get entity(): string | null {
            return getSchemaEntity(this.root) || getSchemaEntity(this.schema);
        }
    //endregion

    //region JsonFormSchema Helpers
        /**
         * Property containing the cached pattern property root.
         */
        private _patternRequiredPropertyCache: string[];

        /**
         * The cache for the proeprty root.
         */
        private _propertyRoot: SchemaPropertyMap<JsonSchema>;

        /**
         * Get all schema properties.
         *
         * @return Dictionary of property names and their JsonSchemas.
         */
        public get propertyRoot(): SchemaPropertyMap<JsonSchema> {
            if (!!this._propertyRoot) {
                return this._propertyRoot;
            }

            return this._propertyRoot = this.findPropertiesMap(this.root);
        }

        /**
         * Takes an schema and finds the schema properties object.
         */
        protected findPropertiesMap(schema: JsonSchema, schemaPathPrefix: string = ''): SchemaPropertyMap<JsonSchema> {
            if (this.hasPatternProperties(schema)) {
                return this.findPatternPropertiesMap(schema, schemaPathPrefix);
            }
            else if (schema.type === 'object') {
                if (!this.propertyRootSchemaPointerMap) {
                    this.createPropertyRootCache(schemaPathPrefix + 'properties', schema.properties);
                }

                return schema.properties;
            }
            // @warn this does not work, because the path prefix should already include an array-index in order to make this work.
            // @warn if we enable this, it is complete guess work what array index we are working with.
            // @warn if anyone ever demands this feature you would have to refactor this method to also add the "/0" index to the getPropertyPointer function.
            // else if (schema.type === 'array' && !_.isArray(schema.items as JsonSchema)) {
            //     if ((schema.items as JsonSchema).$ref != null) {
            //         return this.findPropertiesMap(this.getEmbeddedSchema((schema.items as JsonSchema).$ref), schemaPathPrefix + 'items/');
            //     }

            //     return this.findPropertiesMap(schema.items as JsonSchema, schemaPathPrefix + 'items/');
            // }
            else {
                return { };
            }
        }

        /**
         * Builds the cache of (required) pattern properties
         */
        private findPatternPropertiesMap(schema: JsonSchema, schemaPathPrefix: string = ''): SchemaPropertyMap<JsonSchema> {
            var properties = { };

            // begin with any regular properties, if they are set
            if (_.isPlainObject(schema.properties) && _.size(schema.properties) > 0) {
                properties = _.assign({}, schema.properties) as SchemaPropertyMap<JsonSchema>;

                this.createPropertyRootCache(schemaPathPrefix + 'properties', schema.properties);
            }
            this._patternRequiredPropertyCache = [];

            var parts = this.propertyPrefix.split('/'),
                matchable = !!parts && !!parts[1] ? String(parts[1]) : '';
            if (matchable.length === 0) {
                debug(`[warn] propertyRoot is matching on an empty first property root path (${this.propertyPrefix}), so this will probably cause unexpected behaviour.`);
            }

            _.each(schema.patternProperties, (schema: JsonSchema, pattern: string) => {
                if (matchable.search(pattern) >= 0) {
                    properties = _.assign(properties, schema.properties) as SchemaPropertyMap<JsonSchema>;

                    this.createPropertyRootCache(schemaPathPrefix + `patternProperties/${pattern}/properties`, schema.properties);

                    if (_.isArray(schema.required)) {
                        this._patternRequiredPropertyCache.push(...schema.required);
                    }
                }
            });

            return properties;
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
                    this.propertyRoot;
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

        /**
         * Get the property title property for the given language.
         *
         * If the language code is not given, english is returned.
         * If the schema is a draft-4 formatted title (no multilang), then the value is considered english.
         *
         * @param name The name of the property/field.
         * @param language The language code to fetch the title for (optional).
         *
         * @return The title for the given field, for the given language or null if not available for the given language.
         */
        public getFieldTitle(name: string, language: string = 'en'): string | null {
            return this.getFieldTranslatableString(name, 'title', language);
        }

        /**
         * Get the property description property for the given language.
         *
         * If the language code is not given, english is returned.
         * If the schema is a draft-4 formatted description (no multilang), then the value is considered english.
         *
         * @param name The name of the property/field.
         * @param language The language code to fetch the title for (optional).
         *
         * @return The description for the given field, for the given language or null if not available for the given language.
         */
        public getFieldDescription(name: string, language: string = 'en'): string | null {
            return this.getFieldTranslatableString(name, 'description', language);
        }

        /**
         * Get the field's translatable property for the given language.
         *
         * If the language code is not given, english is returned.
         * If the schema is a draft-4 formatted title (no multilang), then the value is considered english.
         *
         * @param name The name of the property/field.
         * @param messageType The property that contains the translatable string(s).
         * @param language The language code to fetch the title for (optional).
         *
         * @return The title for the given field, for the given language or null if not available for the given language.
         */
        private getFieldTranslatableMessage(name: string, messageType: string, language: string = 'en'): string | null {
            if (this.fields[name] == null || _.isEmpty((<any> this.fields[name])[messageType])) {
                return null;
            }

            let translatable: string | SchemaTranslatableStringMap = (<any> this.fields[name])[messageType];
            if (_.isString(translatable)) {
                return _.startsWith(language, 'en') ? translatable as string : null;
            }

            if (_.isObject(translatable)) {
                return _.find(translatable as SchemaTranslatableStringMap, (v: string, k: string) => _.startsWith(k, language));
            }

            return null;
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
            var lnk: any[] = [];
            if (_.isArray(this.root.links)) {
                lnk = lnk.concat(this.root.links);
            }
            if (_.isArray(this.schema.links)) {
                lnk = lnk.concat(this.schema.links);
            }
            return lnk;
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
         * Set property or field value.
         *
         * @param name The name of the property to set.
         * @param data The data object to set the property on.
         * @param value The value of the property.
         */
        public setPropertyValue(name: string, data: any, value: any): void {
            pointer.set(data, this.getPropertyPointer(name), value);
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
         * Get the property schema pointers.
         *
         * Get the JSON Pointer pointing to the given field property schema/descriptor in this schema
         *
         * @param name The name of the property to get the pointer to.
         *
         * @return The pointers to the given property schema.
         */
        public getPropertySchemaPointer(name: string): string[] {
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
            for (var prop of this.identityProperties) {
                result[prop] = this.getPropertyValue(prop, data);
            }
            return result;
        }

        /**
         * Set the identity value for the given data.
         *
         * @param data The data to set the identity value on.
         * @param identity The identity value to set for this data object.
         */
        public setIdentityValue(data: any, identity: IdentityValue | IdentityValues): any {
            if (_.isPlainObject(identity)) {
                return this.setIdentityValues(data, identity as IdentityValues);
            }

            this.setPropertyValue(this.identityProperty, data, identity);
            return data;
        }

        /**
         * Set all identity property values found in the schema from the source on the traget data object.
         *
         * @param data The data to set the identities value on.
         * @param identities The identity values to set for this data object.
         */
        public setIdentityValues(data: any, identities: IdentityValues): any {
            for (var prop of this.identityProperties) {
                this.setIdentityValues(data, this.getPropertyValue(prop, identities));
            }
            return data;
        }

        /**
         * Creates a cache with properties and how to access them in the schema.
         */
        protected createPropertyRootCache(basePath: string, obj: { [key: string]: any }): void {
            if (!this.propertyRootSchemaPointerMap) {
                this.propertyRootSchemaPointerMap = { };
            }

            _.each(obj, (val, key) =>
                this.propertyRootSchemaPointerMap[key.toLowerCase()] =
                    _.map(this.propertyDefinitionRoots, x =>
                        fixJsonPointerPath(_.last(x.split('#'))) + fixJsonPointerPath(basePath, true) + key));
        }
    //endregion

    /**
     * Whether or not the schema has patterned properties in it's root.
     */
    public hasPatternProperties(schema: JsonSchema = this.root): boolean {
        return (!!schema.patternProperties && _.size(schema.patternProperties) > 0);
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

        if (!_.includes(schemaId, '#')) {
            schemaId += '#';
        }

        if (schemaId == this.schema.id) {
            return this.schema;
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
     * Scoring meaning:
     * - 0 = Primary identity (ID, Id, UId, {SchemaName}Id, ...)
     * - 1 = Parent identity ({Partial<SchemaName>}Id, ...)
     * - 2 = Sibling identity identity (ItemId, ItemUId, ...)
     * - 3 = Composite Primary identity (String/Numeric, name, ...)
     * - 4 = Not very likely to be an identity
     *
     * @param name The property to score.
     *
     * @return The priority of the given property as an identifying property.
     */
    protected isIdentityProperty(name: string): 0 | 1 | 2 | 3 | 4 {
        let lname = name.toLocaleLowerCase();

        if (this.isPrimaryIdentityProperty(name)) {
            return 0;
        }
        else if (this.isParentIdentityProperty(name)) {
            return 1;
        }
        else if (lname.indexOf('id') >= 0 || lname.indexOf('uid') >= 0 || lname.indexOf('guid') >= 0) {
            return 2;
        }
        else if (lname === 'name' || lname === 'identity' || lname === 'internalname') {
            return 3;
        }
        return 4;
    }

    /**
     * Check whether or not the given proeprty is (the) primary identity property.
     *
     * @param name The property name to identify.
     */
    protected isPrimaryIdentityProperty(name: string): boolean {
        var lname = name.toLowerCase().replace(/[^0-9a-z]/gi, ''),
            entity = this.entity.toLowerCase();

        if (lname === 'id' || lname === 'uid' || lname === 'guid') {
            return true;
        }

        if (this.hasIdentitySuffix(lname, entity)) {
            return true;
        }

        return false;
    }


    /**
     * Check whether or not the given property is a parent property.
     *
     * @param name The property name to identify.
     */
    protected isParentIdentityProperty(name: string): boolean {
        var parents = this.entity.match(/[A-Z][a-z]+/g),
            current = parents.pop().toLowerCase(),
            lname = name.toLowerCase().replace(/[^0-9a-z]/gi, '');

        // Check whether the property is a reference in a chained table.
        if (lname === current + 'id' || lname === current + 'uid') {
            return false;
        }

        // Check most combinations of the parent properties.
        for (let i = 0; i < parents.length; i++) {
            current = parents.slice(0, i).join().toLowerCase();
            if (this.hasIdentitySuffix(lname, current)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check whether or not the given property has an identity like suffix.
     *
     * @param name The name to check with.
     * @param comparable The thing to compare with, and to check for an identity like suffix.
     */
    protected hasIdentitySuffix(name: string, comparable: string): boolean {
        if (name === comparable + 'id' || name === comparable + 'uid' || name === comparable) {
            return true;
        }
        return false;
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
}
