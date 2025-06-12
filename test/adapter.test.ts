import { newEnforcer, Enforcer } from 'casbin';
import * as path from 'path';
import { IoRedisAdapter, IConnectionOptions } from '../src/index';

async function getEnforcer(options: IConnectionOptions): Promise<Enforcer> {
    const adapter = await IoRedisAdapter.newAdapter(options);
    const modelPath = path.resolve(__dirname, 'model.conf');
    const enforcer = await newEnforcer(modelPath, adapter);
    return enforcer;
}

describe('IoRedisAdapter', () => {

    let enforcer: Enforcer;
    const redisOptions: IConnectionOptions = { host: 'localhost', port: 6379, db: 0 };

    beforeEach(async ()=> {
        const adapter = await IoRedisAdapter.newAdapter(redisOptions);
        const modelPath = path.resolve(__dirname, 'model.conf');
        enforcer = await newEnforcer(modelPath, adapter);

        // Clear the Redis database before each test
        const redis = (enforcer.getAdapter() as any).redisInstance;
        await redis.flushdb();

        await enforcer.addPolicy('alice', 'data1', 'read');
        await enforcer.addPolicy('bob', 'data2', 'write');
        await enforcer.addGroupingPolicy('charlie', 'admin');
    })

    afterAll(async () => {
        // Clear the Redis database before each test
        const redis = (enforcer.getAdapter() as any).redisInstance;
        await redis.flushdb();
        // close the Redis connection after all tests
        await (enforcer.getAdapter() as IoRedisAdapter).close();
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