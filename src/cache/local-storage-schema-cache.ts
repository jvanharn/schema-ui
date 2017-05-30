import { JsonSchema } from '../models/schema';
import { CommonJsonSchema } from '../models/common';
import { ISchemaCache } from './schema-cache';

import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:cache:localstorage');

const schemaCacheBucketName = 'schemacache';
const schemaCacheBucketRootList = 'root';

//region LocalStorage Definition
    declare interface Storage {
        readonly length: number;
        clear(): void;
        getItem(key: string): string | null;
        key(index: number): string | null;
        removeItem(key: string): void;
        setItem(key: string, data: string): void;
        [key: string]: any;
        [index: number]: string;
    }
    declare var window: { readonly localStorage: Storage, readonly sessionStorage: Storage };
    declare var global: { readonly localStorage: Storage, readonly sessionStorage: Storage };
    if (typeof window !== 'undefined') {
        var platformStorage: Storage = window.localStorage || window.sessionStorage;
    }
    else if (typeof global !== 'undefined') {
        var platformStorage: Storage = global.localStorage || global.sessionStorage;
    }
//endregion

/**
 * Schema cache that stores (fetched) schema's in the localStorage.
 */
export class LocalStorageSchemaCache implements ISchemaCache {
    /**
     * Index of all schemas.
     */
    private schemas: SchemaCacheEntry[] = [];

    /**
     * Checks whether or not localstorage is available on the current platform.
     */
    public constructor() {
        if (!platformStorage) {
            throw new Error('Cannot create a localStorage-based schema cache, because the localstorage is unavailable.');
        }
        this.loadSchemaList();
    }

    /**
     * Get a json-schema by id.
     *
     * @param id Schema id of the referenced schema.
     *
     * @return string
     */
    public getSchema(id: string): JsonSchema {
        return this.getEntry(_.find(this.schemas, x => x.id.toLowerCase() === id.toLowerCase()));
    }

    /**
     * Add/set a schema in the cache.
     *
     * @param schema The JsonSchema to add to the cache.
     */
    public setSchema(schema: JsonSchema): void {
        if (schema == null || schema.id == null) {
            throw new Error(`LocalStorageSchemaCache.setSchema: Cannot cache the given schema; the schema or it's id is not set.`);
        }

        // Create entry
        var entry: SchemaCacheEntry = {
            id: schema.id,
            name: !!(schema as CommonJsonSchema).entity
                ? this.getSchemaNameForSchemaEntity((schema as CommonJsonSchema).entity)
                : this.getSchemaNameForSchemaId(schema.id)
        };
        this.schemas.push(entry);

        // Save the listing
        this.saveSchemaList();

        // Save the schema in cache.
        this.setEntry(entry, schema);
    }

    /**
     * @inherit
     */
    public removeSchema(id: string): void {
        this.clearEntry(_.find(this.schemas, x => x.id === id))
    }

    /**
     * Get a schema by a predicate.
     *
     * @param predicate The predicate that will decide whether the given schema, is the schema you need.
     *
     * @return JsonSchema
     */
    public getSchemaBy(predicate: (schema: JsonSchema) => boolean): JsonSchema {
        for (var entry of this.schemas) {
            let schema = this.getEntry(entry);
            if (predicate(schema)) {
                return schema;
            }
        }
        return null;
    }

    /**
     * Iterate over every schema in the cache.
     *
     * Heavy operation, should be avoided at all cost.
     *
     * @param predicate The operation that should be executed for every schema in the cache.
     */
    public each(predicate: (schema: JsonSchema) => void): void {
        for (var entry of this.schemas) {
            predicate(this.getEntry(entry));
        }
    }

    /**
     * Clear all cached entries.
     */
    public clear(): void {
        // Clear all items that are set in the root list
        _.each(this.schemas, x => this.clearEntry(x));

        // Clear items that slipped out by manual editing or desynchronisation between tabs.
        for (var i = 0; i < platformStorage.length; i++) {
            let key = platformStorage.key(i);
            if (key.substr(0, schemaCacheBucketName.length) === schemaCacheBucketName) {
                platformStorage.removeItem(key);
            }
        }

        this.schemas = [];
        this.saveSchemaList();
    }

    //region internal methods
        /**
         * Get an JsonSchema by an entry.
         */
        private getEntry(entry?: SchemaCacheEntry): JsonSchema | null {
            if (entry == null) {
                return null;
            }

            var result = platformStorage.getItem(this.prefixStorageProperty(entry.name));
            if (result == null) {
                return null;
            }

            return JSON.parse(result);
        }

        /**
         * Set entry in cache. (Wont update listing)
         */
        private setEntry(entry: SchemaCacheEntry, schema: JsonSchema): void {
            platformStorage.setItem(this.prefixStorageProperty(entry.name), JSON.stringify(schema));
        }

        /**
         * Remove an entry from cache.
         */
        private clearEntry(entry?: SchemaCacheEntry | SchemaCacheEntry[]): void {
            if (_.isArray(entry) && entry.length > 0) {
                _.each(entry, x => !!x.name ? platformStorage.removeItem(x.name) : void 0);
            }
            else if (!!entry && !!(<SchemaCacheEntry>entry).name) {
                platformStorage.removeItem((<SchemaCacheEntry>entry).name);
            }
        }

        /**
         * Saves the current rootlist (this.schemas) to the cache.
         */
        private saveSchemaList(): void {
            try {
                platformStorage.setItem(
                    this.prefixStorageProperty(schemaCacheBucketRootList),
                    JSON.stringify(this.schemas));
            }
            catch (e) {
                // If something goes wrong, just clear the cache to be sure everything stays working.
                debug('[warn] couldnt cache the schema list, something went wrong:', e);
                this.clear();
            }
        }

        /**
         * Loads the schemas from cache.
         */
        private loadSchemaList(): void {
            var result = platformStorage.getItem(this.prefixStorageProperty(schemaCacheBucketRootList));
            if (!!result) {
                this.schemas = JSON.parse(result);
            }
        }

        /**
         * Prefixes the given name according to the bucket name.
         */
        private prefixStorageProperty(name: string): string {
            return `${schemaCacheBucketName}-${name}`;
        }

        /**
         * Get the schema name by taking the last part of the schema id.
         */
        private getSchemaNameForSchemaId(schemaId: string): string {
            return _.kebabCase(schemaId.split('/').slice(2).join('-'));
        }

        /**
         * Get the entity name by making the entity name kebab-cased.
         */
        private getSchemaNameForSchemaEntity(schemaEntity: string): string {
            return _.kebabCase(schemaEntity);
        }
    //endregion
}

interface SchemaCacheEntry {
    /**
     * Identity of the schema.
     */
    id: string;

    /**
     * Name of the schema.
     */
    name: string;
}
