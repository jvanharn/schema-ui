import { ISchemaAgent, HeaderDictionary, SchemaAgentResponse, SchemaAgentRejection } from "../agents/schema-agent";
import { SchemaHyperlinkDescriptor } from "../models/schema";
import { IdentityValues } from "../models/form";
import { ICursor } from "../cursors/cursor";

import * as debuglib from 'debug';
const debug = debuglib('schema:agent:throttle');

/**
 * Agent throttle queue.
 *
 * This class makes it possible to easily queue calls and throttle them.
 */
export class AgentThrottleQueue {
    /**
     * The items currently in the queue.
     */
    private queue: AgentThrottleQueueItem[] = [];

    /**
     * Get the queue length.
     */
    public get queued(): number {
        return this.queue.length;
    }

    /**
     * Whether or not the timer is running.
     */
    private timerId: number = null;

    /**
     * Constructor for this queue.
     *
     * @param delay Minimal amount of seconds between groups of calls.
     * @param groupSize Execute groups of this many requests at a time.
     * @param checkInterval How often it will check for calls, if it had nothing to do last time.
     */
    public constructor(public readonly delay: number = 5000, public groupSize: number = 10, public checkInterval: number = delay) { }

    /**
     * Queue call to agent.
     *
     * @param agent Agent to make the execute call on.
     * @param call Call descriptor to be executed.
     * @return Promise when the call has been made.
     */
    public queueCall<TRequest, TResponse>(agent: ISchemaAgent, call: AgentExecuteCall<TRequest>): Promise<SchemaAgentResponse<TResponse>> {
        if (this.timerId == null) {
            this.runTimer();
        }

        return new Promise((resolve, reject) => this.queue.push({ agent, call, resolve, reject }));
    }

    /**
     * Queue multiple calls at once, and track progress.
     *
     * @param agent
     * @param calls
     * @param progress
     * @return
     */
    public queueCalls(agent: ISchemaAgent, calls: AgentExecuteCall<any>[], progress?: (index: number, call: AgentExecuteCall<any>, result: SchemaAgentResponse<any>) => void): Promise<void> {
        var promises: Promise<any>[] = [];

        for (let i = 0; i < calls.length; i++) {
            promises.push(this.queueCall<any, any>(agent, calls[i])
                .then(result => {
                    if (typeof progress === 'function') {
                        progress(i, calls[i], result);
                    }
                    return result;
                }));
        }

        return Promise.all(promises) as any;
    }

    // /**
    //  * Fire and forget queue call to agent.
    //  *
    //  * Errors with this mechanism are catched and thrown away!
    //  *
    //  * @param agent
    //  * @param call
    //  */
    // public queueCallAsync(agent: ISchemaAgent, call: AgentExecuteCall): void {

    // }

    /**
     * Queue the given base call for every item in the given.
     *
     * @param agent
     * @param cursor
     * @param call
     * @param progress
     */
    public queueCallsByCursor(agent: ISchemaAgent, cursor: ICursor<any>, call: AgentExecuteCall<any>, progress?: (index: number, item: any, result: SchemaAgentResponse<any>) => void): Promise<void> {
        var promises: Promise<any>[] = [];

        for (let page = 1; page <= cursor.totalPages; page++) {
            promises.push(cursor.select(page).then(items => {
                debug(`queueing calls for page ${page} of ${cursor.totalPages} from [${cursor.schema.schemaId}]`);
                return Promise.all(items.map(
                    (item, index) => this.queueCall(agent, {
                        link: call.link,
                        headers: call.headers,
                        data: call.data,
                        urlData: Object.assign(item, call.urlData),
                    }).then(result => {
                        if (typeof progress === 'function') {
                            progress(((page - 1) * cursor.limit) + index, item, result);
                        }
                        return result;
                    })));
            }));
        }

        return Promise.all(promises) as any;
    }

    /**
     * Starts the timer to invoke timed groups of requests.
     */
    private runTimer(): void {
        this.timerId = 1;
        this.executeNextGroup().then(processed => {
            if (this.timerId != null) {
                this.timerId = setTimeout(() => {
                    if (this.timerId != null) {
                        this.runTimer();
                    }
                }, processed > 0 ? this.delay : this.checkInterval);
            }
        });
    }

    /**
     * Executes the next group of queued items.
     */
    private executeNextGroup(): Promise<number> {
        var group: Promise<void>[] = [];

        for (let i = 0; i < this.groupSize && this.queued > 0; i++) {
            let next = this.queue.shift();
            group.push(next.agent.execute(next.call.link, next.call.data, next.call.urlData, next.call.headers)
                .then(x => next.resolve(x))
                .catch((err: SchemaAgentRejection) => {
                    // Check if we can re-do the request
                    if (err.code === 429 || err.code === 408 || (err.code >= 500 && err.code <= 504)) {
                        // Re-add the item to the queue.
                        this.queue.unshift(next);
                    }
                    else {
                        next.reject(err);
                    }
                }));
        }

        return Promise.all(group).then(result => result.length);
    }

    /**
     * Stop any running timer.
     */
    private stopTimer(): void {
        if (this.timerId == null) {
            return;
        }
        clearTimeout(this.timerId);
        this.timerId = null;
    }
}

/**
 * Queued agent call.
 */
export interface AgentThrottleQueueItem {
    /**
     * Reference to the agent to make the call on.
     */
    agent: ISchemaAgent;

    /**
     * Definition of the call to make.
     */
    call: AgentExecuteCall<any>;

    /**
     * Method to call when the item is succesfully executed.
     */
    resolve: Function;

    /**
     * Method to call when, while executing, an error ocurred or was returned.
     */
    reject: Function;
}

/**
 * Defines the call on a schema agent.
 */
export interface AgentExecuteCall<TRequest> {
    /**
     * The link to call.
     */
    link: SchemaHyperlinkDescriptor;

    /**
     * The data for the request.
     */
    data?: TRequest;

    /**
     * The url data to identify the resource.
     */
    urlData?: IdentityValues;

    /**
     * Extra information for the transport.
     */
    headers?: HeaderDictionary;
}
