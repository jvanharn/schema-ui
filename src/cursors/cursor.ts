import { JsonSchema } from '../models/schema';
import { EventEmitter } from 'eventemitter3';

import * as _ from 'lodash';
import * as debuglib from 'debug';
var debug = debuglib('schema:cursor');

/**
 * Interface for iterating over a paginated datasource.
 *
 * Used for paginating over an resource collection, filtering it and displaying in tables.
 *
 * @event beforePageChange {PageChangeEvent} Before a page change has ocurred it gives the page we are going to change to.
 * @event afterPageChange {PageChangeEvent} After a page change has ocurred.
 */
export interface ICursor<T> extends EventEmitter {
    /**
     * The page that the items collection currently reflects in the datasource.
     */
    readonly current: number;

    /**
     * The maximum amount of items per page.
     * @default 40
     */
    limit: number;

    /**
     * Total number of items in the datasource.
     */
    readonly count: number;

    /**
     * Total number of pages in the datasource.
     */
    readonly totalPages: number;

    /**
     * Items in the current page.
     */
    readonly items: T[];

    /**
     * Parameter is used to indicate that the cursor is loading.
     * @default CursorLoadingState.Uninitialized
     */
    readonly loadingState: CursorLoadingState;

//region Page changing
    /**
     * Whether there's a page before the current one.
     */
    hasPrevious(): boolean;

    /**
     * Whether there's a page after the current one.
     */
    hasNext(): boolean;

    /**
     * Used to navigate to the next page.
     *
     * @return A promise resolving in the page's items.
     */
    next(): Promise<T[]>;

    /**
     * Used to navigate to the previous page.
     *
     * @return A promise resolving in the page's items.
     */
    previous(): Promise<T[]>;

    /**
     * Select a page by number.
     *
     * @param pageNumber The 1-indexed page to navigate to.
     * @param forceReload Whether or not to force a reload of the age, even if we are already on the given page.
     *
     * @return A promise resolving in the page's items.
     */
    select(pageNumber: number, forceReload?: boolean): Promise<T[]>;

    /**
     * Reloads the currently loaded page.
     *
     * @return A promise resolving in the items on the current page.
     */
    refresh(): Promise<T[]>;
//endregion

    /**
     * Get all the items inside the collection as a promised list.
     *
     * As some collections may contain millions of items, please *always* check the total count of the collection first.
     *
     * @param limit The maximum amount of items per page to use during the fetching of all pages.
     *
     * @return A promise resolving in all the items in this collection (Beware, this can pottentially be millions of items).
     */
    all(limit?: number): Promise<T[]>;

    /**
     * Event fired before the page is changed to another.
     */
    on(ev: 'beforePageChange', fn: (event: PageChangeEvent<T>) => void, ctx?: any): this;
    once(ev: 'beforePageChange', fn: (event: PageChangeEvent<T>) => void, ctx?: any): this;

    /**
     * Event fired after the page is changed to another, with the new page number and the fetched items.
     */
    on(ev: 'afterPageChange', fn: (event: PageChangeEvent<T>) => void, ctx?: any): this;
    once(ev: 'afterPageChange', fn: (event: PageChangeEvent<T>) => void, ctx?: any): this;
}

/**
 * The loading state of the cursor.
 */
export enum CursorLoadingState {
    /**
     * The cursor hasn't yet fetched the first page of the cursor.
     */
    Uninitialized,

    /**
     * The cursor is currently fetching a page.
     */
    Loading,

    /**
     * The cursor has fetched a page and is ready to be read.
     */
    Ready,

    /**
     * The cursor is empty, and the collection doesn't contain any items.
     */
    Empty
}

/**
 * Defines an event that is fired when the page is chang[ing/ed].
 */
export interface PageChangeEvent<T> {
    /**
     * The page number that was loaded.
     */
    page: number;

    /**
     * The items that were fetched, or null when this is the before event.
     */
    items?: T[];
}

export function getAllCursorPages<T>(cursor: ICursor<T>): Promise<T[]> {
    return new Promise((resolve, reject) => {
        var firstPage: Promise<T[]>;
        debug(`getAllCursorPages: fetching all pages of cursor for [${(cursor.constructor as any).name}]->{}`);
        if (this.loadingState > CursorLoadingState.Uninitialized) {
            if (this.loadingState === CursorLoadingState.Ready) {
                debug(`getAllCursorPages: firstpage already loaded`);
                firstPage = Promise.resolve(this.items);
            }
            else {
                debug(`getAllCursorPages: firstpage loaded on afterPageChange event`);
                firstPage = new Promise(resolve => this.once('afterPageChange', (x: PageChangeEvent<T>) => resolve(x.items)));
            }
        }
        else {
            debug(`getAllCursorPages: firstpage loaded by select(1)`);
            firstPage = this.select(1);
        }

        firstPage
            .then(items => {
                var promises: Promise<T[]>[] = [Promise.resolve(this.items)];
                for (var i = 2; i <= this.totalPages; i++) {
                    promises.push(this.select(i));
                }
                Promise
                    .all(promises)
                    .then(result => {
                        resolve(_.flatten(result));
                    })
                    .catch(reject);
            })
            .catch(reject);
    });
}
