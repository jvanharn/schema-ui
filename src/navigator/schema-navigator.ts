import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:navigator');

import {
    JsonSchema,
    JsonFormSchema,
    JsonTableSchema,
    SchemaPropertyMap,
    SchemaDataPointerMap,

    IdentityValue,
    IdentityValues,

    SchemaHyperlinkDescriptor,
    SchemaColumnDescriptor,

    SchemaTranslatableStringMap
} from '../models/index';
import {
    fixJsonPointerPath,
    getApplicablePropertyDefinitions,
    getSchemaEntity,
    resolveAndMergeSchemas
} from './utils';
import { tryPointerGet, pointerSet, pointerGet } from '../helpers/json-pointer';

/**
 * The default fieldset name, if none is defined.
 */
export const defaultFieldsetId = 'default';

export const linkUriTemplateRegexp = /[^{\}]+(?=})/g;

export const defaultVisibleFieldTypes = ['integer', 'numeric', 'string', 'boolean'];

/**
 * Helper object for retrieving information from json-schema's.
 */
export class SchemaNavigator {
    /**
     * Cache where a list of resolved schemaids to properties is saved into.
     */
    protected schemaIdPointerMap: { [schemaId: string]: string };

    /**
     * A list of all the definitions that apply to the given propertyPrefix.
     */
    protected readonly propertyDefinitionRoots: string[];

    /**
     * Construct a new schema navigator.
     *
     * @param schema The schema to wrap as navigable.
     * @param propertyPrefix The json-pointer that is used to prefix the area this navigator will look in with it's methods. (Defines the schema root)
     * @param schemaReferenceResolver User method that optionally resolves references in the schema, to calculate schema roots etc.
     */
    public constructor(
        protected readonly schema: JsonSchema | JsonFormSchema | JsonTableSchema,
        public readonly propertyPrefix: string = '/',
        protected readonly schemaReferenceResolver?: (ref: string) => JsonSchema,
    ) {
        if (this.schema == null) {
            debug('[warn] tried to create navigable-schema with empty schema');
            throw new Error('Cannot make a null schema navigable, the schema property is required.');
        }

        // Fix the property prefix
        this.propertyPrefix = fixJsonPointerPath(propertyPrefix, true);

        // Determine the property definition root(s).
        this.propertyDefinitionRoots = getApplicablePropertyDefinitions(this.schema, this.propertyPrefix, this.getSchema.bind(this));

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
                this._root = resolveAndMergeSchemas(this.propertyDefinitionRoots, x => this.getEmbeddedSchema(x));

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
         * JSON-Pointer to the document identity value.
         */
        public get identityPointer(): string {
            return this.propertyPrefix + this.identityProperty;
        }

        /**
         * The property used to cache the sorted identities once calculated.
         */
        private _identityProperties: string[];

        /**
         * Get's a list of all identity-like properties in the document. (Not only the main one)
         *
         * This list is sorted by it's identity score.
         */
        public get identityProperties(): string[] {
            if (this._identityProperties) {
                return this._identityProperties;
            }

            var props = this.propertyRoot,
                identities: [number, string][] = [[0, this.identityProperty]],
                score: number;
            for (let key in props) {
                if (key === this.identityProperty) {
                    continue;
                }
                score = this.isIdentityProperty(key);
                if (props.hasOwnProperty(key) && score < 4) {
                    identities.push([score, key]);
                }
            }

            // Always return an array with at least one item in it.
            if (identities.length < 1) {
                return this._identityProperties = [this.identityProperty];
            }

            return this._identityProperties = _.orderBy(identities, x => x[0]).map(x => x[1]);
        }

        /**
         * JSON-Pointers pointing to all the identity values in the document.
         */
        public get identityPointers(): string[] {
            // @todo Do a recurse loop over all properties in the document and save the results.
            return this.identityProperties.map(x => `/${x}`);
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
            if (this._entity) {
                return this._entity;
            }
            return this._entity = getSchemaEntity(this.root) || getSchemaEntity(this.schema);
        }
        public set entity(entity: string | null) {
            this._entity = entity;
        }

        /**
         * Cached version of the above entity name fetcher.
         */
        private _entity: string | null;
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
         * @warn This only works if the given relative root path points to an schema of type "object"!
         *
         * @return Dictionary of property names and their JsonSchemas.
         */
        public get propertyRoot(): SchemaPropertyMap<JsonSchema> {
            if (!!this._propertyRoot) {
                return this._propertyRoot;
            }

            if (this.hasPatternProperties(this.root)) {
                debug(
                    'unable to find the propertyRoot for an schema where the root does not point to a schema of type object.\n' +
                    'Try setting the schemaRootPrefix to the pattern sub property that contains the root of the form to be generated.');
                return this._propertyRoot = { };
            }
            else if (this.root.type === 'object') {
                return this._propertyRoot = this.root.properties;
            }
            else if (this.root.type === 'array') {
                debug(
                    'unable to find the propertyRoot for an schema where the root does not point to a schema of type object.\n' +
                    'Try setting the schemaRootPrefix to the sub index that contains the form you want to render.');
                return this._propertyRoot = { };
            }
            else {
                debug(`unable to find the schema propertyRoot, defaulting to an empty object.`);
                return this._propertyRoot = { };
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
         * @return An dictionary of all visible fields in this JsonFormSchema.
         */
        public get fields(): SchemaDataPointerMap<JsonFormSchema> {
            let props = this.propertyRoot,
                fields: SchemaDataPointerMap<JsonFormSchema> = { };
            for (let key in props) {
                if (!props.hasOwnProperty(key)) {
                    continue;
                }

                if (this.qualifiesAsFormField(props[key] as JsonFormSchema)) {
                    fields[this.propertyPrefix + key] = props[key] as JsonFormSchema;
                }
            }
            return fields;
        }

        /**
         * Get all fields in the form grouped by fieldsetid.
         */
        public get fieldsets(): FieldsetFieldMap {
            return this.getFieldsetsFromPropertyRoot(this.propertyRoot as SchemaPropertyMap<JsonFormSchema>, this.propertyPrefix, defaultFieldsetId, name => this.isFieldRequired(name));
        }

        /**
         * Checks whether the given schema qualifies as a subschema/fieldset.
         */
        private qualifiesAsSubform(field: JsonFormSchema): boolean {
            return field.type === 'object' && _.isObject(field.properties) && !this.hasPatternProperties(field);
        }

        /**
         * Checks whether the given schema is a visible form field.
         */
        private qualifiesAsFormField(field: JsonFormSchema, name?: string): boolean {
            return (!!field.field && (
                field.field.visible === true ||
                (field.field.type != null && field.field.visible !== false) ||
                (field.field.visible !== false && !(name in this.identityProperties) && defaultVisibleFieldTypes.indexOf(field.type) > -1)
            ));
        }

        /**
         * Get fieldsets from the given property root.
         */
        private getFieldsetsFromPropertyRoot(
            properties: SchemaPropertyMap<JsonFormSchema>,
            pointerPrefix: string = '/',
            fieldsetId: string = defaultFieldsetId,
            isRequiredProperty?: (name: string) => boolean
        ): FieldsetFieldMap {
            var props = properties,
                fieldsets: FieldsetFieldMap = Object.create({});
            for (var key in props) {
                if (!props.hasOwnProperty(key)) {
                    continue;
                }

                if (this.qualifiesAsSubform(props[key] as JsonFormSchema)) {
                    _.assign(
                        fieldsets,
                        this.getFieldsetsFromPropertyRoot(
                            props[key].properties as SchemaPropertyMap<JsonFormSchema>,
                            pointerPrefix + key + '/',
                            _.camelCase(pointerPrefix + key),
                            name => _.includes(props[key].required, name)));
                }
                else if (this.qualifiesAsFormField(props[key] as JsonFormSchema)) {
                    if (fieldsets[fieldsetId] == null) {
                        fieldsets[fieldsetId] = [];
                    }

                    fieldsets[fieldsetId].push(_.assign({
                        name: key,
                        pointer: pointerPrefix + key,
                        isRequired: isRequiredProperty(key)
                    }, props[key] as ExtendedFieldDescriptor) as ExtendedFieldDescriptor);
                }
            }
            return fieldsets;
        }

        /**
         * Check whether the field in this schema root is required.
         *
         * @param name The field-name of the field to check. Has to be returned by the fields property.
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
         * @param pointer The pointer to the property/field in the data.
         * @param language The language code to fetch the title for (optional).
         *
         * @return The title for the given field, for the given language or null if not available for the given language.
         */
        public getFieldTitle(pointer: string, language: string = 'en'): string | null {
            return this.getFieldTranslatableMessage(pointer, 'title', language);
        }

        /**
         * Get the property description property for the given language.
         *
         * If the language code is not given, english is returned.
         * If the schema is a draft-4 formatted description (no multilang), then the value is considered english.
         *
         * @param pointer The pointer to the property/field in the data.
         * @param language The language code to fetch the title for (optional).
         *
         * @return The description for the given field, for the given language or null if not available for the given language.
         */
        public getFieldDescription(pointer: string, language: string = 'en'): string | null {
            return this.getFieldTranslatableMessage(pointer, 'description', language);
        }

        /**
         * Get the field's translatable property for the given language.
         *
         * If the language code is not given, english is returned.
         * If the schema is a draft-4 formatted title (no multilang), then the value is considered english.
         *
         * @param pointer The pointer to the property/field in the data.
         * @param messageType The property that contains the translatable string(s).
         * @param language The language code to fetch the title for (optional).
         *
         * @return The title for the given field, for the given language or null if not available for the given language.
         */
        private getFieldTranslatableMessage(pointer: string, messageType: string, language: string = 'en'): string | null {
            if (pointer == null || pointer === '') {
                return null;
            }

            pointer = fixJsonPointerPath(pointer);

            if (this.fields[pointer] == null || _.isEmpty((<any> this.fields[pointer])[messageType])) {
                return null;
            }

            let translatable: string | SchemaTranslatableStringMap = (<any> this.fields[pointer])[messageType];
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
            return Array.isArray((this.schema as JsonTableSchema).columns)
                ? (this.schema as JsonTableSchema).columns
                : this.generateColumns();
        }

        /**
         * Generate a list of column descriptors, if the entity does not contain one.
         */
        public generateColumns(): SchemaColumnDescriptor[] {
            let props = this.propertyRoot,
                cols: SchemaColumnDescriptor[] = [];
            for (var key in props) {
                if (!props.hasOwnProperty(key)) {
                    continue;
                }

                if (!_.includes(String(key).toLowerCase(), 'id') && _.includes(['string', 'number', 'integer', 'boolean'], props[key].type)) {
                    var type: string = null;
                    if (props[key].type === 'string' && props[key].format != null) {
                        type = props[key].format;
                    }
                    else if (props[key].type === 'boolean') {
                        type = 'boolean';
                    }

                    cols.push({
                        id: key,
                        path: '/' + key,
                        type
                    } as SchemaColumnDescriptor);
                }
            }
            return cols;
        }
    //endregion

    //region Json Hyperschema Helpers
        private _links: SchemaHyperlinkDescriptor[];

        /**
         * Get all schema hyperlinks.
         */
        public get links(): SchemaHyperlinkDescriptor[] {
            if (!this._links) {
                this._links = [];
                if (Array.isArray(this.root.links)) {
                    Array.prototype.push.apply(this._links, this.root.links);
                }
                if (Array.isArray(this.schema.links) && this.schema.links !== this.root.links) {
                    Array.prototype.push.apply(this._links, this.schema.links);
                }
            }
            return this._links;
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

        /**
         * Get a mapping of uri keys to object pointers.
         *
         * @param link The link to get the pointers for.
         */
        public getLinkUriTemplatePointers(link: SchemaHyperlinkDescriptor): { [key: string]: string } {
            if ((link as any).templatePointers) {
                return (link as any).templatePointers;
            }

            var keys = link.href.match(linkUriTemplateRegexp);
            if (keys == null) {
                return {};
            }

            return _.fromPairs(keys.map(x => {
                var key = x.replace(/[+#./;?&]/, '');
                return [key, this.propertyPrefix + key] as [string, string];
            }));
        }

        /**
         * Check whether the given link requires an instance of the object to be resolved (e.g. it has template pointers).
         *
         * @param link The link to check.
         */
        public hasLinkUriTemplatePointers(link: SchemaHyperlinkDescriptor): boolean {
            if (link == null) {
                return false;
            }

            if (typeof (link as any).templatePointers === 'object') {
                return Object.keys((link as any).templatePointers).length > 0;
            }

            var keys = link.href.match(linkUriTemplateRegexp);
            if (keys == null) {
                return false;
            }
            return keys.length > 0;
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
            return pointerGet(data, this.getPropertyPointer(name));
        }

        /**
         * Set property or field value.
         *
         * @param name The name of the property to set.
         * @param data The data object to set the property on.
         * @param value The value of the property.
         */
        public setPropertyValue(name: string, data: any, value: any): void {
            pointerSet(data, this.getPropertyPointer(name), value);
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
         * Get the identity value for the given data.
         *
         * @param data The data to fetch the identity property value from.
         *
         * @return The identity property value.
         */
        public getIdentityValue(data: any): IdentityValue {
            try {
                return pointerGet(data, this.identityPointer);
            }
            catch (e) {
                return pointerGet(data, this.identityPointer.substr(this.propertyPrefix.length - 1));
            }
        }

        /**
         * Whether or no the identity value has been set to a undefined value. (Any value is ok)
         *
         * @param data The data to fetch the identity property value from.
         *
         * @return Whether or not the identity value is set to a non null/undefined value.
         */
        public hasIdentityValue(data: any): boolean {
            return tryPointerGet(data, this.identityPointer) != null;
        }

        /**
         * Get all identity property values found in the schema.
         *
         * @param data The data to fetch the identity property values from.
         *
         * @return The identity property value dictionary.
         */
        public getIdentityValues(data: any): IdentityValues {
            var result: IdentityValues = { };
            for (var prop of this.identityProperties) {
                try {
                    result[prop] = this.getPropertyValue(prop, data);
                    if (result[prop] === void 0) {
                        delete result[prop];
                    }
                }
                catch (e) { /* */ }
            }

            if (_.isEmpty(result)) {
                throw new Error('Unable to fetch any identity value!');
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
                identity = this.getIdentityValue(identity as IdentityValues);
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
                this.setPropertyValue(prop, data, this.getPropertyValue(prop, identities));
            }
            return data;
        }
    //endregion

    //region Pointer Field Operators
        /**
         * Get the Json (form) schema for the property-pointer in the result data.
         *
         * @param dataPointer Schema root-relative pointer that points to the property in the described object, to get the schema for.
         *
         * @return The json-schema.
         */
        public getFieldDescriptorForPointer(dataPointer: string): JsonFormSchema[] {
            try {
                var schemas = getApplicablePropertyDefinitions(this.root, dataPointer, this.getSchema.bind(this));
                return schemas.map(p => {
                    var splitter = p.indexOf('#');
                    if (splitter === -1) {
                        return pointerGet(this.root, p);
                    }

                    var [subId, subPoint] = p.split('#');
                    if (subId === '' || subId + '#' === this.schemaId) {
                        return pointerGet(this.root, subPoint);
                    }

                    var subSchema = this.getSchema(subId + '#');
                    if (subSchema != null) {
                        return pointerGet(subSchema, subPoint);
                    }

                    debug(`getFieldDescriptorForPointer: unable to find/retrieve the schema with id "${subId}#"`);
                    return null;
                }).filter(x => x != null);
            }
            catch (err) {
                debug(`getFieldDescriptorForPointer: retrieving the field descriptor resulted in an error: `, err);
                return [];
            }
        }

        /**
         * Select the correct descriptor for the given value.
         *
         * Warning: Does not take into account required values, thus if the value is null, it will return the first descriptor.
         *
         * @param descriptors A list of possible descriptors for the field. (Call {@see getFieldDescriptorForPointer} to fetch this list)
         * @param value The value to find a descriptor for.
         *
         * @return JSON Form Schema for the field, or null if no valid schema exists for the given value.
         */
        public getFieldDescriptorForValue(descriptors: JsonFormSchema[], value: any): JsonFormSchema | null {
            var field: JsonFormSchema = null;
            if (descriptors.length === 1 && value == null) {
                field = descriptors[0];
            }
            else if (typeof value === 'string') {
                field = descriptors.find(x => x.type === 'string');
            }
            else if (typeof value === 'number') {
                field = descriptors.find(x => x.type === 'integer' || x.type === 'number');
            }
            else if (Array.isArray(value)) {
                var arr = descriptors.find(x => x.type === 'array');
                if (typeof arr.items === 'object') {
                    field = arr.items as JsonFormSchema;
                    if (typeof field.field !== 'object' && typeof arr.field === 'object') {
                        field.field = arr.field;
                    }
                }
            }
            return field;
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
            return pointerGet(this.schema, fixJsonPointerPath(schemaId.substr(1)));
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

        return pointerGet(this.schema, fixJsonPointerPath(sp));
    }

    /**
     * Get an embedded schema or try to fetch the schema using the user supplied method on construction of the navigator.
     *
     * @param schemaId The schema id to retrieve.
     *
     * @return The JsonSchema or null if it could not be found.
     */
    public getSchema(schemaId: string): JsonSchema | null {
        var embedded = this.getEmbeddedSchema(schemaId);
        if (embedded != null) {
            return embedded;
        }

        if (this.schemaReferenceResolver) {
            return this.schemaReferenceResolver(schemaId);
        }

        return null;
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
    public isIdentityProperty(name: string): 0 | 1 | 2 | 3 | 4 {
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
        var parents = _.upperFirst(this.entity).match(/[A-Z][a-z]+/g);
        if (parents == null) {
            return false;
        }

        var current = parents.pop().toLowerCase(),
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
     *
     * Traverses over all unique schemaIds within the current schema.
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

/**
 * Map/dictionary containing property names and a sub-schema.
 */
export type FieldsetFieldMap = { [fieldsetId: string]: ExtendedFieldDescriptor[]; };

/**
 * Extension to the default JsonFormSchema that is generated by the SchemaNavigator to convey additional calculated data for form-builders.
 */
export interface ExtendedFieldDescriptor extends JsonFormSchema {
    /**
     * Original property name of the field.
     */
    name: string;

    /**
     * The pointer you can use to fetch the property value.
     */
    pointer: string;

    /**
     * Whether or not this field is required.
     */
    isRequired: boolean;
}
