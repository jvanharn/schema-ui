import * as _ from 'lodash';
import * as pointer from 'json-pointer';
import * as debuglib from 'debug';
var debug = debuglib('schema:utils');

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

    var parts = _.filter(path.split('/'), x => !_.isEmpty(x));
    if (parts.length === 0) {
        return leadingSlash ? '/' : '';
    }
    return '/' + parts.join('/') + (leadingSlash ? '/' : '');
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
        return convertSchemaIdToEntityName(schema.id);
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
            schemaPathPrefix = (schema.id || '') + '#';
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
            return _.flatMap(schema.patternProperties, (sub, key) => {
                // Check if the key is applicable.
                var regex = new RegExp(String(key));
                if (!regex.test(String(_.first(cleaned)))) {
                    return [];
                }

                return getApplicablePropertyDefinitions(
                    sub,
                    '/' + cleaned.slice(1).join('/'),
                    referenceResolver,
                    schemaPathPrefix + '/patternProperties/' + key)
            });
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

/**
 * Resolve and merge the list of given schemaId refs (subpaths supported).
 *
 * @param schemas List of schema ids.
 * @param resolver Method called to resolve the uri part of the url.
 *
 * @return Resolve and merge the given schemas.
 */
export function resolveAndMergeSchemas(schemas: string[], resolver: (id: string) => JsonSchema): JsonSchema {
    return _
        .partialRight(_.assignInWith, (a: any, b: any) => {
            if (_.isObject(a) && _.isObject(b)) {
                return _.assign(a, b);
            }
            else if (_.isArray(a) && _.isArray(b)) {
                return _.concat(a, b);
            }
        })
        .apply(_, _.map(schemas, x => {
            try {
                var [url, path] = x.split('#');
                var schema = resolver(url + '#');
                if (!schema) {
                    throw new Error(`Unable to find the schema id ${url}.`);
                }

                if (path == null || path === '/' || path === '') {
                    return schema;
                }

                let sub = pointer.get(schema, path);
                if (!!sub && sub.$ref != null) {
                    sub = resolver(sub.$ref);
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
        }))
}
