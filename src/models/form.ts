import { CommonJsonSchema } from './common';

/**
 * Json Schema with Form extensions.
 */
export interface JsonFormSchema extends CommonJsonSchema {

    /**
     * Information describing a field
     */
    field: SchemaFieldDescriptor;
}

/**
 * Type alias for identity-like values.
 */
export type IdentityValue = string | number;

/**
 * Type alias for a collection of identity-like values.
 */
export type IdentityValues = { [ key: string ]: IdentityValue };

/**
 * Describes how a Form Field should be rendered by the UserAgent.
 */
export interface SchemaFieldDescriptor
{
    /**
     * Name of the property being represented.
     */
    name?: string;

    /**
     * Name of the field type, it should be rendered as (if it should be different than the default logic resolving)
     */
    type?: string;

    /**
     * Whether or not the current property should be visible as a form field.
     *
     * If not set, but an explicit field type is set, implies visible. If true or false then those are used. In all other cases defaults to false.
     */
    visible?: boolean;

    /**
     * Data that can be used by the renderer to alter the display of the field.
     */
    data?: { [key: string]: any };

    /**
     * Optional hyperlink name (ref) which describes where to fetch data related to this field. (E.g. when the current field is an id, an link to an resource that lists all possible values.)
     *
     * Either:
     *  - An string, refering to an unique "rel" value.
     *  - An integer, refering to the index of the link to use.
     */
    link?: string | number;

    /**
     * When a link is specified, this property optionally identifies the identity property of the targeted schema/resource that should be matched with the contents of this property.
     */
    targetIdentity?: string;
}
