# Casbin ioredis Adapter

[![NPM version](https://img.shields.io/npm/v/@ocean.chat/casbin-ioredis-adapter.svg?style=flat-square)](https://www.npmjs.com/package/@ocean.chat/casbin-ioredis-adapter)
[![NPM downloads](https://img.shields.io/npm/dm/@ocean.chat/casbin-ioredis-adapter.svg?style=flat-square)](https://www.npmjs.com/package/@ocean.chat/casbin-ioredis-adapter)
[![License](https://img.shields.io/npm/l/@ocean.chat/casbin-ioredis-adapter.svg?style=flat-square)](https://github.com/JamesWilson19970101/redis-adapter/blob/main/LICENSE)

English | [简体中文](./README-zh.md)

`@ocean.chat/casbin-ioredis-adapter` is a Casbin adapter that allows you to use Redis as a policy storage backend. It utilizes the ioredis library for efficient Redis communication.

## Installation

Via npm:

```bash
npm install @ocean.chat/casbin-ioredis-adapter
```

Or via yarn:

```bash
yarn add @ocean.chat/casbin-ioredis-adapter
```

## Simple Usage

```typescript
import { newEnforcer, Enforcer } from 'casbin';
import { IoRedisAdapter, IConnectionOptions } from '@ocean.chat/casbin-ioredis-adapter';
import * as path from 'path'; // Ensure @types/node is installed for path module
import { RedisOptions } from 'ioredis'; // For advanced ioredis options

async function main() {
    // 1. Configure Redis connection options
    const redisConnectionOptions: IConnectionOptions = {
        host: 'localhost', // Your Redis server host
        port: 6379,        // Your Redis server port
        // password: 'your-redis-password', // Optional: if your Redis requires a password
        // db: 0,                           // Optional: Redis database number, defaults to 0
    };

    // Optional: Additional ioredis-specific options
    const advancedRedisOpts: RedisOptions = {
        // keyPrefix: 'casbin_policies:', // Example: prefix all Casbin-related keys
        // enableOfflineQueue: false,    // Example: disable offline queueing
    };

    // 2. Create an adapter instance
    // The second argument for ioredis options is optional
    const adapter = await IoRedisAdapter.newAdapter(redisConnectionOptions, advancedRedisOpts);
    // const adapter = await IoRedisAdapter.newAdapter(redisConnectionOptions); // Without advanced options

    // 3. Create a Casbin Enforcer instance
    // Replace 'path/to/your/model.conf' with the actual path to your Casbin model file
    const modelPath = path.resolve(__dirname, 'model.conf'); // Example: model.conf in the same directory
    const enforcer: Enforcer = await newEnforcer(modelPath, adapter);

    // 4. Use the Enforcer instance
    // Policies are typically loaded from Redis when the enforcer is initialized.
    // If you need to explicitly reload policies (e.g., after external changes to Redis), you can use:
    // await enforcer.loadPolicy();

    // Add policies
    // These will be automatically saved to Redis by the adapter
    await enforcer.addPolicy('alice', 'data1', 'read');
    await enforcer.addPolicy('bob', 'data2', 'write');
    await enforcer.addGroupingPolicy('charlie', 'admin'); // 'g' policy for user-role mapping

    console.log('Policies added.');

    // Check permissions
    const aliceCanReadData1 = await enforcer.enforce('alice', 'data1', 'read');
    console.log('Alice can read data1:', aliceCanReadData1); // Expected: true

    const bobCanReadData1 = await enforcer.enforce('bob', 'data1', 'read');
    console.log('Bob can read data1:', bobCanReadData1); // Expected: false

    const charlieIsAdmin = await enforcer.hasRoleForUser('charlie', 'admin');
    console.log('Charlie is an admin:', charlieIsAdmin); // Expected: true

    // Get all 'p' (policy) rules
    console.log('All p policies:', await enforcer.getPolicy());
    // Get all 'g' (grouping/role) rules
    console.log('All g policies:', await enforcer.getGroupingPolicy());

    // Remove a policy
    await enforcer.removePolicy('bob', 'data2', 'write');
    console.log('Bob\'s write policy for data2 removed.');
    const bobCanWriteData2AfterRemove = await enforcer.enforce('bob', 'data2', 'write');
    console.log('Bob can write data2 after removal:', bobCanWriteData2AfterRemove); // Expected: false

    // If you want to completely overwrite all policies in Redis with the current state
    // of the enforcer's model (e.g., after loading policies from a file and then saving to Redis),
    // you can use:
    // await enforcer.savePolicy();
    // Note: addPolicy, removePolicy, etc., when called on the enforcer,
    // will trigger the adapter's corresponding methods, which save changes incrementally.

    // 5. Close the Redis connection when your application shuts down
    // This is important for releasing resources.
    await adapter.close();
    console.log('Redis connection closed.');
}

main().catch(error => {
    console.error('An error occurred:', error);
    // Ensure adapter connection is closed even on error if it was initialized
    // This part would require more robust error handling in a real application
});
```

## API

The IoRedisAdapter implements the Casbin FilteredAdapter interface. Key methods include:

- static async newAdapter(options: IConnectionOptions, redisOpts?: RedisOptions): Promise<IoRedisAdapter>
  - Factory method to create and initialize an adapter instance.
  - options: Basic Redis connection details (host, port, password, db).
  - redisOpts: Optional advanced ioredis specific options.
- async loadPolicy(model: Model): Promise<void>
  - Loads all policy rules from Redis into the Casbin model.
- async loadFilteredPolicy(model: Model, filter: Filter): Promise<void>
  - Loads a filtered set of policy rules from Redis into the Casbin model based on the provided filter.
- async savePolicy(model: Model): Promise<boolean>
  - Saves all policy rules from the Casbin model to Redis. This will overwrite all existing policies in Redis under the designated key.
- async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void>
  - Adds a single policy rule to Redis. The change is persisted immediately.
- async removePolicy(sec: string, ptype: string, rule: string[]): Promise<void>
  - Removes a single policy rule from Redis. The change is persisted immediately.
- async removeFilteredPolicy(sec: string, ptype: string, fieldIndex: number, ...fieldValues: string[]): Promise<void>
  - Removes policy rules from Redis that match the given filter criteria. The change is persisted immediately.
- isFiltered(): boolean
  - Returns true if the adapter is currently in a filtered state (i.e., loadFilteredPolicy has been called and not all policies are loaded).
- async close(): Promise<void>
  - Closes the underlying ioredis connection. It's important to call this when your application is shutting down to release resources.

## How it Works
This adapter stores all Casbin policies (both p for policy rules and g for grouping/role rules) as a single JSON array under a specific key in Redis. By default, this key is 'policies'.

When addPolicy, removePolicy, or removeFilteredPolicy are called, the adapter updates its in-memory cache of policies and then overwrites the entire 'policies' key in Redis with the updated list.
When savePolicy is called, all policies are read from the Casbin Model object, and then this complete set overwrites the 'policies' key in Redis.
loadPolicy reads the entire list from the 'policies' key.
This approach is straightforward but means that for every modification, the entire policy set is re-serialized and sent to Redis. For very large policy sets or extremely high write loads, this might have performance implications.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.