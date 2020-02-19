
/**
 * Json schema interface with hypermedia extensions.
 *
 * @link http://json-schema.org/latest/json-schema-core.html
 */
export interface JsonSchema {
    /**
     * Schema used, is prabably always the same. Refers to the version of JSON schema used.
     */
    $schema?: string;

    /**
     * Referenced schema.
     */
    $ref?: string;

    /**
     * Identity of the schema.
     *
     * The "id" keyword defines a URI for the schema, and the base URI that other URI references within the schema are resolved against. The "id" keyword itself is resolved against the base URI that the object as a whole appears in.
     *
     * If present, the value for this keyword MUST be a string, and MUST represent a valid URI-reference [RFC3986]. This value SHOULD be normalized, and SHOULD NOT be an empty fragment <#> or an empty string <>.
     */
    id?: string;

    /**
     * Related schemas linked to inside the same schema.
     */
    definitions?: SchemaDefinitionMap<JsonSchema>;

//region Validation Extension
    /**
     * Title/label of the property.
     */
    title?: SchemaTranslatableString;

    /**
     * Description of the schema/property.
     */
    description?: SchemaTranslatableString;

    /**
     * Type of field. E.g. integer, number, string, object, ...
     */
    type?: string;

    /**
     * Properties inside the schema if the type is "object".
     */
    properties?: SchemaPropertyMap<JsonSchema>;

    /**
     * List of properties that are mapped based upon a regex.
     */
    patternProperties?: SchemaPatternPropertyMap<JsonSchema>;

    /**
     * Whether or not additional properties are allowed, or when given a schema, what the propoerty names should validate for.
     */
    additionalProperties?: boolean | JsonSchema;

    /**
     * The description of valid items for a field of type "array".
     */
    items?: JsonSchema | JsonSchema[];

    /**
     * Required properties when the type is "object".
     */
    required?: string[];

    /**
     * The default value for this property, if unset.
     */
    default?: any;

//region String
    /**
     * (Predefined) format for the string value.
     */
    format?: string;

    /**
     * Minimum length for the string value.
     */
    minLength?: number;

    /**
     * Maximum length for the string value.
     */
    maxLength?: number;

    /**
     * Regex pattern to validate the string against.
     */
    pattern?: string;
//endregion

//region Number, Integer
    /**
     * Minimum boundry for the numeric value.
     */
    minimum?: number;

    /**
     * Whether or not the given minimum is exclusive or not, defaults to inclusive.
     */
    exclusiveMinimum?: number;

    /**
     * Maximum boundary for the numeric value.
     */
    maximum?: number;

    /**
     * Whether or not the maximum is inclusive or exclusive, default to inclusive.
     */
    exclusiveMaximum?: number;

    multipleOf?: number;
//endregion

//region Array
    /**
     * The minimum amount of items in an array.
     *
     * Only for array types.
     */
    minItems?: number;

    /**
     * The maximum amount of items in an array.
     *
     * Only for array types.
     */
    maxItems?: number;

    /**
     * Whether or not the array must contain only distinct/unique items.
     */
    uniqueItems?: boolean;
//endregion

//region object
    /**
     * Minimum amount of properties.
     */
    minProperties?: number;

    /**
     * Maximum amount of properties.
     */
    maxProperties?: number;
//endregion

    /**
     * Enumerable containing the possible values for this property.
     */
    enum?: string[];

//region Schema Constructs
    /**
     * The current instance must validate against all listed schemas.
     */
    allOf?: JsonSchema[];

    /**
     * The instance must validate against any of the listed schemas.
     */
    anyOf?: JsonSchema[];

    /**
     * The schema must validate against one and only one schema.
     */
    oneOf?: JsonSchema[];

    /**
     * The instance must not validate against the given schema.
     */
    not?: JsonSchema;
//endregion

//endregion

//region Hyperschema Extension
    /**
     * If present, this keyword is resolved against the current URI base that the entire instance is found within,
     * and sets the new URI base for URI references within the instance. It is therefore the first URI Reference resolved,
     * regardless of which order it was found in.
     */
    base?: string;

    /**
     * Whether or not this property is readonly.
     */
    readOnly?: boolean;

    /**
     * Schema links to other related interfaces.
     */
    links?: SchemaHyperlinkDescriptor[];

    /**
     * Information about the media type and how to interpret or decode it.
     */
    media?: SchemaMediaDescriptor;
//endregion
}

/**
 * The "media" property indicates that this instance contains non-JSON data encoded in a JSON string. It describes the type of content and how it is encoded.
 */
export interface SchemaMediaDescriptor {
    /**
     * If the instance value is a string, this property defines that the string SHOULD be interpreted as binary data
     * and decoded using the encoding named by this property.
     *
     * RFC 2045, Sec 6.1 [RFC2045] lists the possible values for this property.
     */
    binaryEncoding: string;

    /**
     *
     */
    type: string;
}

export interface SchemaHyperlinkDescriptor {
    /**
     * Descriptor for the related resource type.
     *
     * Should be from the curated list inside the RFC5988 (should be referenced from there).
     * @link https://tools.ietf.org/html/rfc5988#section-6.2.2
     * @link http://www.iana.org/assignments/link-relations/link-relations.xhtml
     */
    rel: string;

    /**
     * HTTP method to execute on the linked resource.
     */
    method?: string;

    /**
     * The url which points to the linked resource.
     *
     * Can contain parameters and the like. It uses RFC6570 with some extra rules.
     * @link https://tools.ietf.org/html/rfc6570 RFC6570 - URI Templates
     */
    href: string;

    /**
     * The encoding type to use when performing an request on the linked resource.
     */
    encType?: string;

    /**
     * Media type/mime-type of the target.
     */
    mediaType?: string;

    /**
     * Schema of the request and the data inside of it.
     */
    schema?: JsonSchema;

    /**
     * Title for the link.
     *
     * Can be used to display the resource as a link by the useragent.
     */
    title?: string;

    /**
     * Target schema for the response of the request described in the link descriptor.
     */
    targetSchema?: JsonSchema
}

/**
 * Map/dictionary containing schema names and a sub-schema.
 */
export type SchemaDefinitionMap<T extends JsonSchema> = { [name: string]: T; };

/**
 * Map/dictionary containing property names that to a sub-schema.
 */
export type SchemaPropertyMap<T extends JsonSchema> = { [property: string]: T; };

/**
 * Map/dictionary containing schemas with json-pointers as keys that point to the data as described by the parent schema.
 */
export type SchemaDataPointerMap<T extends JsonSchema> = { [dataPointer: string]: T; };

/**
 * Map/dictionary of properties that use regex as the index.
 */
export type SchemaPatternPropertyMap<T extends JsonSchema> = { [propertyPattern: string]: T; };

/**
 * Map/dictionary with a language key as index, that can be used to provide localized translation strings.
 */
export type SchemaTranslatableString = string | SchemaTranslatableStringMap;
export type SchemaTranslatableStringMap = { [lang: string]: string };
