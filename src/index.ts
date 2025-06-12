/**
 * Casbin adapter for ioredis.
 * This adapter allows Casbin to use Redis as a policy storage backend,
 * leveraging the ioredis library for Redis communication.
 */

// TODO: The entire policy set is re-serialized and sent to Redis for every modification. For very large policy sets or extremely high write loads, this might have performance implications.

import { Helper, Model, FilteredAdapter } from 'casbin';
import Redis, { RedisOptions } from 'ioredis';

export interface IConnectionOptions {
    host: string;
    port: number;
    password?: string;
    db?: number;
}

export interface Filters {
    [ptype: string]: string[];
}

class Line {
    ptype: string = '';
    v0: string = '';
    v1: string = '';
    v2: string = '';
    v3: string = '';
    v4: string = '';
    v5: string = '';
}

export class IoRedisAdapter implements FilteredAdapter {

    private readonly redisInstance: Redis;
    private policies: Line[] = [];
    private filtered: boolean = false;

    /**
     * The constructor for IoRedisAdapter.
     * @param options Redis connection options.
     * @param redisOpts Additional options for ioredis.
     */
    constructor(options: IConnectionOptions, redisOpts?: RedisOptions) {
        // Set a default retry strategy for ioredis.
        const defaultRedisOpts: RedisOptions = {
            retryStrategy(times: number): number | null {
                if (times > 10) {
                    // Stop retrying after 10 attempts.
                    console.error('Redis retry attempts exhausted, stop retrying.');
                    return null;
                }
                // The delay for reconnection, increasing by 100ms each time, up to a maximum of 3 seconds.
                const delay = Math.min(times * 100, 3000);
                console.log(`Redis connection lost. Retrying in ${delay}ms...`);
                return delay;
            },
        };

        this.redisInstance = new Redis({
            ...options,
            ...defaultRedisOpts,
            ...redisOpts,
        });
    }

    /**
     * newAdapter is a factory method for creating an instance of IoRedisAdapter.
     * @param options Redis connection options.
     * @param redisOpts Additional options for ioredis.
     */
    public static async newAdapter(options: IConnectionOptions, redisOpts?: RedisOptions): Promise<IoRedisAdapter> {
        const adapter = new IoRedisAdapter(options, redisOpts);
        // ioredis emits a 'ready' event when it's ready to process commands.
        await new Promise<void>(resolve => adapter.redisInstance.on('ready', resolve));
        return adapter;
    }


    public isFiltered(): boolean {
        return this.filtered;
    }

    private savePolicyLine(ptype: string, rule: string[]): Line {
        const line = new Line();
        line.ptype = ptype;
        switch (rule.length) {
            case 6:
                line.v5 = rule[5];
            case 5:
                line.v4 = rule[4];
            case 4:
                line.v3 = rule[3];
            case 3:
                line.v2 = rule[2];
            case 2:
                line.v1 = rule[1];
            case 1:
                line.v0 = rule[0];
                break;
            default:
                throw new Error('Rule should not be empty or have more than 6 arguments.');
        }
        return line;
    }


    private loadPolicyLine(line: Line, model: Model): void {
        const lineText =
            line.ptype +
            ', ' +
            [line.v0, line.v1, line.v2, line.v3, line.v4, line.v5]
                .filter(n => n)
                .join(', ');
        Helper.loadPolicyLine(lineText, model);
    }

    /**
     * Stores all policy rules in Redis.
     * @param policies The policies to be stored.
     */
    private async storePolicies(policies: Line[]): Promise<void> {
        await this.redisInstance.set('policies', JSON.stringify(policies))
    }

    /**
     * Loads all policy rules from Redis.
     * @param model The Casbin model.
     */
    public async loadPolicy(model: Model): Promise<void> {
        const policiesJSON = await this.redisInstance.get('policies');

        if (!policiesJSON) {
            return;
        }

        const parsedPolicies = JSON.parse(policiesJSON);
        this.policies = parsedPolicies;

        for (const policy of parsedPolicies) {
            this.loadPolicyLine(policy, model);
        }
    }

    /**
     * Loads a filtered set of policy rules.
     * @param model The Casbin model.
     * @param policyFilter The filter.
     */
    public async loadFilteredPolicy(model: Model, policyFilter: Filters): Promise<void> {
        const policiesJSON = await this.redisInstance.get("policies");
        if (!policiesJSON) {
            return;
        }

        const parsedPolicies: Line[] = JSON.parse(policiesJSON);

        const filteredPolicies = parsedPolicies.filter((policy: Line) => {
            if (!(policy.ptype in policyFilter)) {
                return false;
            }

            const tempPolicy = [policy.v0, policy.v1, policy.v2, policy.v3, policy.v4, policy.v5];
            const tempFilter = policyFilter[policy.ptype];

            if (tempFilter.length > tempPolicy.length) {
                return false;
            }

            // Check if each value in the filter matches the policy.
            return tempFilter.every((filterValue, i) => !filterValue || filterValue === tempPolicy[i]);
        });

        for (const policy of filteredPolicies) {
            this.loadPolicyLine(policy, model);
        }

        this.filtered = true;
    }

    /**
     * Saves the current policies from the model to Redis.
     * @param model The Casbin model.
     * @returns Returns true if successful.
     */
    public async savePolicy(model: Model): Promise<boolean> {
        const policyRuleAST = model.model.get("p")!;
        const groupingPolicyAST = model.model.get("g")!;
        const policies: Line[] = [];

        for (const astMap of [policyRuleAST, groupingPolicyAST]) {
            if (!astMap) continue;
            for (const [ptype, ast] of astMap) {
                for (const rule of ast.policy) {
                    const line = this.savePolicyLine(ptype, rule);
                    policies.push(line);
                }
            }
        }
        
        // Save all policies.
        await this.storePolicies(policies);
        // Update the in-memory policy cache.
        this.policies = policies; 
        return true;
    }

    /**
     * Adds a policy rule to the storage.
     * @param sec 'p' or 'g'.
     * @param ptype 'p' or 'g'.
     * @param rule The policy rule.
     */
    public async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        const line = this.savePolicyLine(ptype, rule);
        this.policies.push(line);
        await this.storePolicies(this.policies);
    }

    /**
     * Removes a policy rule from the storage.
     * @param sec 'p' or 'g'.
     * @param ptype 'p' or 'g'.
     * @param rule The policy rule.
     */
    public async removePolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        const policyToRemove = this.savePolicyLine(ptype, rule);
        
        const updatedPolicies = this.policies.filter(policy => {
            // Use JSON.stringify for a more reliable deep object comparison.
            return JSON.stringify(policy) !== JSON.stringify(policyToRemove);
        });

        if (updatedPolicies.length < this.policies.length) {
            this.policies = updatedPolicies;
            await this.storePolicies(this.policies);
        }
    }

    /**
     * Removes policy rules that match a filter from the storage.
     * @param sec 'p' or 'g'.
     * @param ptype 'p' or 'g'.
     * @param fieldIndex The index of the field to start matching from (0-based).
     * @param fieldValues The values to be removed from the policy rule.
     */
    public async removeFilteredPolicy(sec: string, ptype: string, fieldIndex: number, ...fieldValues: string[]): Promise<void> {
        const updatedPolicies = this.policies.filter(policy => {
            if (policy.ptype !== ptype) {
                return true;
            }
            const policyValues = [policy.v0, policy.v1, policy.v2, policy.v3, policy.v4, policy.v5];
            
            // Check if the values from fieldIndex onwards match the fieldValues.
            let matches = true;
            for (let i = 0; i < fieldValues.length; i++) {
                const policyValue = policyValues[fieldIndex + i];
                const filterValue = fieldValues[i];
                if (!filterValue || policyValue !== filterValue) {
                    matches = false;
                    break;
                }
            }

            // If it matches, this policy should be removed, so return false.
            return !matches;
        });

        if (updatedPolicies.length < this.policies.length) {
            this.policies = updatedPolicies;
            await this.storePolicies(this.policies);
        }
    }

    /**
     * Closes the Redis connection.
     */
    public async close(): Promise<void> {
        // The quit method of ioredis returns a Promise.
        await this.redisInstance.quit();
    }
}