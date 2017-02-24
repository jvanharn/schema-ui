import * as _ from 'lodash';
import * as pointer from 'json-pointer';

import { JsonSchema, CommonJsonSchema } from '../models/index';

/**
 * Fixes common mistakes in JsonPointers.
 */
export function fixJsonPointerPath(path: string, leadingSlash: boolean = false): string {
    if (path == null) {
        return leadingSlash ? '/' : '';
    }

    if (path.substr(0, 4) === 'http') {
        var [url, path] = path.split('#');
        return url + '#' + fixJsonPointerPath(path, leadingSlash);
    }

    if (path[0] !== '/' && path[0] !== '$') {
        path = '/' + path;
    }

    if (!leadingSlash && path.length > 1 && path[path.length - 1] === '/') {
        return path.substring(0, path.length - 1);
    }
    else if (!!leadingSlash && path.length > 1 && path[path.length - 1] !== '/') {
        return path + '/';
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
 * @param schemaPathPrefix
 *
 * @return List of all schema-relative paths that apply to the given property.
 */
export function getApplicablePropertyDefinitions(schema: JsonSchema, propertyPath: string, referenceResolver?: (ref: string) => JsonSchema, schemaPathPrefix?: string): string[] {
    if (schemaPathPrefix == null) {
        if (String(schema.id).lastIndexOf('#') >= 0) {
            schemaPathPrefix = schema.id + '';
        }
        else {
            schemaPathPrefix = schema.id + '#';
        }
    }

    let cleaned = _.filter(propertyPath.split('/'), x => !_.isEmpty(x)),
        current = _.first(cleaned),
        isLast = cleaned.length <= 1;

    if (current == null) {
        return [fixJsonPointerPath(schemaPathPrefix)];
    }

    if (schema.$ref != null) {
        schema = !!referenceResolver ? referenceResolver(schema.$ref) : null;
        if (schema == null || _.isEmpty(schema)) {
            throw new Error(`Encountered reference that could not resolved: [${schema.$ref}]`);
        }
        return getApplicablePropertyDefinitions(schema, '/' + cleaned.join('/'), referenceResolver);
    }

    if (schema.type === 'object') {
        if (!!schema.properties && !!schema.properties[current]) {
            return getApplicablePropertyDefinitions(
                schema.properties[current],
                '/' + cleaned.slice(1).join('/'),
                referenceResolver,
                schemaPathPrefix + '/properties/' + current);
        }
        if (!!schema.patternProperties) {
            return _.flatMap(schema.patternProperties, (sub, key) =>
                getApplicablePropertyDefinitions(
                    sub,
                    '/' + cleaned.slice(1).join('/'),
                    referenceResolver,
                    schemaPathPrefix + '/patternProperties/' + key));
        }
    }
    else if (schema.type === 'array') {
        if (_.isObject(schema.items)) {
            return getApplicablePropertyDefinitions(
                schema.items,
                '/' + cleaned.slice(1).join('/'),
                referenceResolver,
                schemaPathPrefix + '/items');
        }
        var index = parseInt(current);
        if (_.isArray(schema.items) && schema.items[index]) {
            return getApplicablePropertyDefinitions(
                schema.items[index],
                '/' + cleaned.slice(1).join('/'),
                referenceResolver,
                schemaPathPrefix + '/items/' + index);
        }
    }

    //@todo support anyOf, allOf, local-$ref-erences, ...

    throw new Error(`Cannot find any way to navigate for path "${propertyPath}" and schema path "${schemaPathPrefix}"!`);
}
