import { JsonSchema } from '../models/schema';
import { ISchemaCache } from './schema-cache';

import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:cache:localstorage');

const schemaCacheBucketName = 'schemacache';
const schemaCacheBucketRootList = 'root';

//region LocalStorage Definition
    // declare interface Storage {
    //     readonly length: number;
    //     clear(): void;
    //     getItem(key: string): string | null;
    //     key(index: number): string | null;
    //     removeItem(key: string): void;
    //     setItem(key: string, data: string): void;
    //     [key: string]: any;
    //     [index: number]: string;
    // }
    // declare var window: { readonly localStorage: Storage, readonly sessionStorage: Storage };
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
     * The registered event listener.
     */
    private readonly registeredBoundEventListener = this.localStorageSchemaCacheChangeListener.bind(this);

    /**
     * Index of all schemas.
     */
    private schemas: { [key: string]: JsonSchema } = Object.create(null);

    /**
     * Checks whether or not localstorage is available on the current platform.
     */
    public constructor() {
        if (!platformStorage) {
            throw new Error('Cannot create a localStorage-based schema cache, because the localstorage is unavailable.');
        }

        // Load the existing value into memory
        this.loadSchemaList();

        // Try and register an event listener, for when the cache changes
        try {
            window.addEventListener('storage', this.registeredBoundEventListener);
        }
        catch (err) {
            debug('[warn] unable to register for storage change events:', err);
        }
    }

    /**
     * Dispose of this schema cache.
     */
    public dispose(): void {
        if (this.schemas == null) {
            return;
        }

        try {
            window.removeEventListener('storage', this.registeredBoundEventListener);
        }
        catch (err) {
            debug('[warn] unable to deregister the storage event listener');
        }
        this.schemas = null;
    }

    /**
     * Event listener that listens to all changed storage keys (by ourselves or others).
     *
     * @param evt
     */
    private localStorageSchemaCacheChangeListener(evt: StorageEvent): void {
        // Somebody else changed the schema, (re)set it for next load!
        if (this.hasCorrectBucketPrefix(evt.key)) {
            var unprefixedKey = this.unprefixStorageProperty(evt.key);
            if (evt.newValue != null) {
                if (evt.url !== window.document.URL) {
                    this.schemas[unprefixedKey] = null;
                }
                else if (!this.schemas[unprefixedKey]) {
                    // User manually editted the schema?
                    debug(`[warn] user possibly manually editted a schema by key "${unprefixedKey}"!`);
                    this.schemas[unprefixedKey] = null;
                }
            }
            else {
                delete this.schemas[unprefixedKey];
            }
        }
    }

    /**
     * Get a json-schema by id.
     *
     * @param schemaId Schema id of the referenced schema.
     *
     * @return string
     */
    public getSchema(schemaId: string): JsonSchema {
        if (this.schemas == null) {
            return null;
        }

        const findKey = this.getSchemaNameForSchemaId(schemaId);
        if (!(findKey in this.schemas)) {
            return null;
        }

        // Key exists, and already cached
        if (this.schemas[findKey] !== null) {
            return this.schemas[findKey];
        }

        // Key exists, but not yet retrieved.
        const storageKey = this.prefixStorageProperty(findKey);
        try {
            return this.schemas[findKey] = JSON.parse(platformStorage.getItem(storageKey));
        }
        catch (err) {
            debug(`[warn] whilst trying to retrieve schema by id "${schemaId}" -> key(${findKey}), parsing of JSON failed:`, err);

            delete this.schemas[findKey];
            platformStorage.removeItem(storageKey);

            return null;
        }
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

        const key = this.getSchemaNameForSchemaId(schema.id);

        // Create entry
        this.schemas[key] = schema;
        platformStorage.setItem(this.prefixStorageProperty(key), JSON.stringify(schema));
    }

    /**
     * @inherit
     */
    public removeSchema(schemaId: string): void {
        if (this.schemas == null) {
            return;
        }

        const key = this.getSchemaNameForSchemaId(schemaId);

        // Remove the schema itself
        delete this.schemas[key];
        platformStorage.removeItem(this.prefixStorageProperty(key));
    }

    /**
     * Get a schema by a predicate.
     *
     * @param predicate The predicate that will decide whether the given schema, is the schema you need.
     *
     * @return JsonSchema
     */
    public getSchemaBy(predicate: (schema: JsonSchema) => boolean): JsonSchema {
        for (const key in this.schemas) {
            if (Object.prototype.hasOwnProperty.call(this.schemas, key)) {
                try {
                    let schema = JSON.parse(platformStorage.getItem(this.prefixStorageProperty(key)));
                    if (predicate(schema)) {
                        return schema;
                    }
                }
                catch (err) {
                    debug(`[warn] while trying to iterate all schemas, one schema by key "${key}" could not be retrieved from the cache!`);
                }
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
        this.getSchemaBy(schema => {
            predicate(schema);
            return false;
        });
    }

    /**
     * Clear all cached entries.
     */
    public clear(): void {
        if (!this.schemas || typeof this.schemas !== 'object') {
            this.schemas = { };
            return;
        }

        try {
            // Clear all items that are set in the root list
            for (const key in this.schemas) {
                if (Object.prototype.hasOwnProperty.call(this.schemas, key)) {
                    platformStorage.removeItem(this.prefixStorageProperty(key));
                }
            }

            // Clear items that slipped out by manual editing or desynchronisation between tabs.
            for (var i = 0; i < platformStorage.length; i++) {
                let key = platformStorage.key(i);
                if (this.hasCorrectBucketPrefix(key)) {
                    platformStorage.removeItem(key);
                }
            }
        }
        catch (err) {
            debug(`[warn] unable to successfully clear all the schemas:`, err);
        }

        this.schemas = { };
    }

    //region internal methods
        /**
         * Loads the schemas from cache.
         */
        private loadSchemaList(): void {
            debug(`check local/sessionStorage for schemas within our bucket named "${schemaCacheBucketName}"`);

            try {
                for (var i = 0; i < platformStorage.length; i++) {
                    let key = platformStorage.key(i);
                    if (this.hasCorrectBucketPrefix(key)) {
                        this.schemas[this.unprefixStorageProperty(key)] = null;
                    }
                }
            }
            catch (err) {
                debug(`[warn] something went wrong trying to read the cached schemas:`, err);
                this.clear();
            }
        }

        /**
         * Prefixes the given name according to the bucket name.
         */
        private prefixStorageProperty(name: string): string {
            return `${schemaCacheBucketName}-${name}`;
        }

        /**
         * Prefixes the given name according to the bucket name.
         */
        private unprefixStorageProperty(name: string): string {
            return name.substr(schemaCacheBucketName.length + 1);
        }

        /**
         * Check whether the given key is contained within the correct bucket.
         */
        private hasCorrectBucketPrefix(key: string): boolean {
            return key.substr(0, schemaCacheBucketName.length) === schemaCacheBucketName;
        }

        /**
         * Get the schema name by taking the last part of the schema id.
         */
        private getSchemaNameForSchemaId(schemaId: string): string {
            return _.kebabCase(schemaId.toLowerCase().split('/').slice(2).join('-'));
        }
    //endregion
}
