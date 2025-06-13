import { newEnforcer, Enforcer } from 'casbin';
import * as path from 'path';
import { IoRedisAdapter, IConnectionOptions } from '../src/index';

const createdAdapters: IoRedisAdapter[] = []; // Array to store all created adapter instances

async function getEnforcer(options: IConnectionOptions): Promise<Enforcer> {
    const adapter = await IoRedisAdapter.newAdapter(options);
    createdAdapters.push(adapter); // Store the adapter
    const modelPath = path.resolve(__dirname, 'model.conf');
    const enforcer = await newEnforcer(modelPath, adapter);
    return enforcer;
}

describe('IoRedisAdapter', () => {
    let enforcer: Enforcer;
    // This specific adapter instance is created in beforeEach and used by some direct adapter calls.
    // It will also be added to createdAdapters.
    let mainAdapterForTests: IoRedisAdapter; 
    const redisOptions: IConnectionOptions = { host: 'localhost', port: 6379, db: 0 };

    beforeEach(async ()=> {
        mainAdapterForTests = await IoRedisAdapter.newAdapter(redisOptions);
        createdAdapters.push(mainAdapterForTests); // Store the adapter
        const modelPath = path.resolve(__dirname, 'model.conf');
        enforcer = await newEnforcer(modelPath, mainAdapterForTests);

        // Clear the Redis database before each test
        const redis = (enforcer.getAdapter() as any).redisInstance;
        await redis.flushdb();

        await enforcer.addPolicy('alice', 'data1', 'read');
        await enforcer.addPolicy('bob', 'data2', 'write');
        await enforcer.addGroupingPolicy('charlie', 'admin');
    })

    afterAll(async () => {
        // Attempt to flush the DB using the first available adapter's instance
        if (createdAdapters.length > 0) {
            const firstAdapter = createdAdapters[0] as any; // Cast to any to access internal redisInstance
            if (firstAdapter.redisInstance && typeof firstAdapter.redisInstance.flushdb === 'function') {
                try {
                    await firstAdapter.redisInstance.flushdb();
                    console.log('Database flushed in afterAll.');
                } catch (err) {
                    console.error('Error flushing database in afterAll:', err);
                }
            }
        }

        // Close all created adapter connections
        for (const adapter of createdAdapters) {
            await adapter.close();
        }
        console.log(`Closed ${createdAdapters.length} adapter connections in afterAll.`);
    });

    test('should save policies to Redis and load them back correctly', async () => {
        await enforcer.savePolicy();

        const newEnforcer = await getEnforcer(redisOptions);
        expect(await newEnforcer.getPolicy()).toEqual([
            ['alice', 'data1', 'read'],
            ['bob', 'data2', 'write'],
        ]);
        expect(await newEnforcer.getGroupingPolicy()).toEqual([['charlie', 'admin']]);
    })

    test('should add a policy and save it', async () => {
        await enforcer.savePolicy();
        
        const adapter = enforcer.getAdapter() as IoRedisAdapter;
        await adapter.addPolicy('p', 'p', ['david', 'data3', 'read']);

        const newEnforcer = await getEnforcer(redisOptions);

        expect(await newEnforcer.getPolicy()).toContainEqual(['david', 'data3', 'read']);
    });

    test('should remove a policy and save the changes', async () => {
        await enforcer.savePolicy();

        const adapter = enforcer.getAdapter() as IoRedisAdapter;
        await adapter.removePolicy('p', 'p', ['alice', 'data1', 'read']);

        const newEnforcer = await getEnforcer(redisOptions);

        expect(await newEnforcer.getPolicy()).not.toContainEqual(['alice', 'data1', 'read']);
        expect(await newEnforcer.getPolicy()).toContainEqual(['bob', 'data2', 'write']);
    });

    test('should remove filtered policies and save the changes', async () => {
        await enforcer.addPolicy('alice', 'data2', 'read');
        await enforcer.addPolicy('alice', 'data3', 'read');
        await enforcer.savePolicy();

        const adapter = enforcer.getAdapter() as IoRedisAdapter;
        await adapter.removeFilteredPolicy('p', 'p', 0, 'alice');

        const newEnforcer = await getEnforcer(redisOptions);

        expect(await newEnforcer.getPolicy()).toEqual([
            ['bob', 'data2', 'write'],
            ['david', 'data3', 'read'],
        ]);
    });

    test('should load a filtered policy', async () => {
        await enforcer.savePolicy();

        const filter = {
            p: ['alice']
        };
        
        const newEnforcer = await getEnforcer(redisOptions);
        const adapter = newEnforcer.getAdapter() as IoRedisAdapter;
        
        expect(adapter.isFiltered()).toBe(false);

        await newEnforcer.loadFilteredPolicy(filter);
        
        expect(adapter.isFiltered()).toBe(true);

        expect(await newEnforcer.getPolicy()).toEqual([['alice', 'data1', 'read']]);
        expect(await newEnforcer.getPolicy()).not.toContainEqual(['bob', 'data2', 'write']);
    });
});