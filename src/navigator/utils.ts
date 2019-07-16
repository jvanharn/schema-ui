import * as _ from 'lodash';
import * as debuglib from 'debug';
const debug = debuglib('schema:utils');

import { JsonSchema, CommonJsonSchema, SchemaPropertyMap, JsonTableSchema } from '../models/index';
import { ISchemaCache } from '../cache/schema-cache';
import { ISchemaFetcher } from '../fetchers/schema-fetcher';
import { createPointer, tryPointerGet } from '../helpers/json-pointer';

/**
 * Fixes common mistakes in JsonPointers.
 */
export function fixJsonPointerPath(path: string, leadingSlash: boolean = false): string {
    if (path == null) {
        return leadingSlash ? '/' : '';
    }

    if (path.indexOf('://') >= 0 || path.indexOf('#') >= 0) {
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
                schema.items as any,
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
 * Get a list all applicable json schema definitions for the given property path.
 *
 * @param schema The schema to give the paths for.
 * @param propertyPath The path to the property in the object that can be validated by the given schema.
 * @param schemaPathPrefix
 *
 * @return List of all schema-relative paths that apply to the given property.
 */
export function filterSchema(schema: JsonSchema, callback: (pointer: string, current?: JsonSchema) => boolean, prefix: string[] = [], result: JsonSchema = {}): JsonSchema {
    var copyProps = (source: any, target: any) => {
        var sourceKeys = Object.getOwnPropertyNames(source);
        for (var key of sourceKeys) {
            if (key !== 'columns' && key !== 'properties' && key !== 'patternProperties' && key !== 'items' && key !== 'anyOf' && key !== 'allOf') {
                target[key] = _.clone(source[key]);
            }
        }
    };
    copyProps(schema, result);

    if (!!schema.properties) {
        result.properties = {} as SchemaPropertyMap<JsonSchema>;

        var sourceProps = Object.getOwnPropertyNames(schema.properties);
        for (let prop of sourceProps) {
            let current = prefix.concat([prop]);
            if (callback(createPointer(current), schema.properties[prop])) {
                filterSchema(schema.properties[prop], callback, current, result.properties[prop] = {});
            }
        }
    }
    if (!!schema.patternProperties) {
        result.patternProperties = {} as SchemaPropertyMap<JsonSchema>;
        var sourcePatterns = Object.getOwnPropertyNames(schema.patternProperties);
        for (let pattern of sourcePatterns) {
            let current = prefix.concat([pattern]);
            if (callback(createPointer(current), schema.patternProperties[pattern])) {
                filterSchema(schema.patternProperties[pattern], callback, current, result.patternProperties[pattern] = {});
            }
        }
    }

    if (schema.items != null) {
        if (Array.isArray(schema.items)) {
            result.items = [];
            for (let i=0; i < schema.items.length; i++) {
                let current = prefix.concat([String(i)]);
                if (callback(createPointer(current), schema.items[i])) {
                    filterSchema(schema.items[i], callback, current, (result.items as JsonSchema[])[i] = {});
                }
            }
        }
        else if (typeof schema.items === 'object') {
            if (callback(createPointer(prefix), schema.items as JsonSchema)) {
                filterSchema(schema.items as JsonSchema, callback, prefix.slice(), result.items = {})
            }
        }
    }

    if (!!schema.allOf) {
        result.allOf = [];
        for (let i=0; i < schema.allOf.length; i++) {
            if (callback(createPointer(prefix), schema.allOf[i])) {
                filterSchema(schema.allOf[i], callback, prefix, (result.allOf as JsonSchema[])[i] = {});
            }
        }
    }

    if (!!schema.anyOf) {
        result.anyOf = [];
        for (let i=0; i < schema.anyOf.length; i++) {
            if (callback(createPointer(prefix), schema.anyOf[i])) {
                filterSchema(schema.anyOf[i], callback, prefix, (result.anyOf as JsonSchema[])[i] = {});
            }
        }
    }

    if ((schema as JsonTableSchema).columns) {
        (result as JsonTableSchema).columns = (schema as JsonTableSchema).columns.filter(x => callback(x.path || `/${x.id}`, void 0));
    }

    return result;
}

/**
 * Resolve and merge the list of given schemaId refs (subpaths supported).
 *
 * This method just merges all types without prejudice. (Dumb merge)
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
                return resolveSchema(x, resolver);
            }
            catch (e) {
                debug(`[warn] unable to fetch the root on path "${x}":`, e);
                return { };
            }
        }))
}

/**
 * Resolve and merge the list of given schemaId refs (subpaths supported).
 *
 * This method intelligently merges the given paths in such a way that there is an Schema for every valid type.
 *
 * @param schemas List of schema ids.
 * @param resolver Method called to resolve the uri part of the url.
 *
 * @return Resolve and merge the given schemas.
 */
export function resolveAndMergeSchemasDistinct(schemas: string[], resolver: (id: string) => JsonSchema): (JsonSchema | JsonSchema[])[] {
    var result: (JsonSchema | JsonSchema[])[] = [];
    for (var id of schemas) {
        var schema = resolveSchema(id, resolver);
        if (isAllOfSubSchema(id)) {
            var existing = _.findIndex(result, x => (x as JsonSchema).type === schema.type);
            if (existing >= 0) {
                if (_.isArray(result[existing]) && _.isArray(schema)) {
                    result[existing] = _.concat(result[existing] as JsonSchema[], schema);
                    continue;
                }
                else if (_.isObject(result[existing]) && _.isObject(schema)) {
                    result[existing] = _.assign({}, result[existing], schema);
                    continue;
                }
                else {
                    debug(`unable to merge two schema definitions`);
                }
            }
        }
        result.push(schema);
    }
    return result;
}

/**
 * Resolve the given schema id and any subschema's.
 */
export function resolveSchema(schemaId: string, resolver: (id: string) => JsonSchema): JsonSchema {
    var [url, path] = schemaId.split('#');
    var schema = resolver(url + '#');
    if (!schema) {
        throw new Error(`Unable to find the schema id ${url}.`);
    }

    if (path == null || path === '/' || path === '') {
        return schema;
    }

    let sub = tryPointerGet(schema, path);
    if (!!sub && sub.$ref != null) {
        sub = resolver(sub.$ref);
    }

    if (!_.isObject(sub) || _.isEmpty(sub)) {
        throw new Error('The property root contained a $ref that pointed to a non-existing(at least not embedded) schema!');
    }

    return sub;
}

export function isAllOfSubSchema(schemaId: string): boolean {
    var splitup = _.last(schemaId.split('#')).split('/');
    return splitup[splitup.length-2] === 'allOf';
}

/**
 * Get a schema from cache or from a fetcher.
 *
 * @param schemaId Identity of the schema to get from cache or fetch.
 * @param cache The cache object to get it from.
 * @param fetcher The fetcher to get it from if the cache does not have it.
 *
 * @return A promise than resolves in the schema.
 */
export function getOrFetchSchema(schemaId: string, cache: ISchemaCache, fetcher?: ISchemaFetcher): Promise<JsonSchema> {
    if (schemaId == null || typeof schemaId !== 'string') {
        return Promise.reject(new Error('A schema-id must be a non-null string.'));
    }

    try {
        var json = cache.getSchema(schemaId);
        if (json != null) {
            return Promise.resolve(json);
        }
    }
    catch (e) { /* */ }

    if (fetcher == null) {
        return Promise.reject(new Error(`Could not source the schema by id [${schemaId}]; no fetcher given.`));
    }

    return fetcher.fetchSchema(schemaId).then(schema => {
        // Try to register the result in the given schema cache
        try {
            cache.setSchema(schema);
        }
        catch(err) {
            debug(`unable to register the schema with id [${schema.id}] with the cache.`, err);
        }

        return schema;
    });
}
