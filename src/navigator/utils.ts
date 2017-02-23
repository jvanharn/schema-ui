import * as _ from 'lodash';

import { JsonSchema, CommonJsonSchema } from '../models/index';

/**
 * Fixes common mistakes in JsonPointers.
 */
export function fixJsonPointerPath(path: string, leadingSlash: boolean = false): string {
    if (path[0] !== '/' && path[0] !== '$') {
        path = '/' + path;
    }
    if (!leadingSlash && path.length > 1 && path[path.length - 1] === '/') {
        return path.substring(0, path.length - 1);
    }
    return path;
}

/**
 * Get the name of the schema entity.
 *
 * @param schema The schema to get the entity for.
 *
 * @return The name of the schema or null.
 */
export function getSchemaEntity(schema: JsonSchema): string | null {
    if (!!(schema as CommonJsonSchema).entity) {
        return (schema as CommonJsonSchema).entity;
    }
    if (!!schema.id) {
        return this.convertSchemaIdToEntityName(schema.id);
    }
    return null;
}

/**
 * Simple attempt at converting a schema id to an entity name without having the actual schema.
 */
export function convertSchemaIdToEntityName(id: string): string {
    return _.upperFirst(_.camelCase(_.last(_.split(id, '/'))));
}

/**
 * Get a list all applicable json schema definitions for the given property path.
 *
 * @param schema The schema to give the paths for.
 * @param propertyPath The path to the property in the object that can be validated by the given schema.
 * @param propertyPathPrefix
 * @param schemaPathPrefix
 *
 * @return List of all schema paths that apply to the given property.
 */
export function getApplicablePropertyDefinitions(
    schema: JsonSchema, propertyPath: string,
    propertyPathPrefix: string = '/', schemaPathPrefix: string = '/'
): string[] {
    let parts = propertyPath.split('/'),
        schemaObj: JsonSchema,
        schemaPath = schemaPathPrefix + '';
    for (var part of parts) {

    }
}
