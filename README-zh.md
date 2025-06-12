# Casbin ioredis Adapter

[![NPM version](https://img.shields.io/npm/v/@ocean.chat/casbin-ioredis-adapter.svg?style=flat-square)](https://www.npmjs.com/package/@ocean.chat/casbin-ioredis-adapter)
[![NPM downloads](https://img.shields.io/npm/dm/@ocean.chat/casbin-ioredis-adapter.svg?style=flat-square)](https://www.npmjs.com/package/@ocean.chat/casbin-ioredis-adapter)
[![License](https://img.shields.io/npm/l/@ocean.chat/casbin-ioredis-adapter.svg?style=flat-square)](https://github.com/JamesWilson19970101/redis-adapter/blob/main/LICENSE)

[English](./README.md) | 简体中文

`@ocean.chat/casbin-ioredis-adapter` 是一个 Casbin 适配器，它允许你使用 Redis 作为策略存储后端。它利用 ioredis 库进行高效的 Redis 通信。

## 安装

通过 npm:

```bash
npm install @ocean.chat/casbin-ioredis-adapter
```

或者通过 yarn:

```bash
yarn add @ocean.chat/casbin-ioredis-adapter
```

## 简单用法

```typescript
import { newEnforcer, Enforcer } from 'casbin';
import { IoRedisAdapter, IConnectionOptions } from '@ocean.chat/casbin-ioredis-adapter';
import * as path from 'path'; // Ensure @types/node is installed for path module
import { RedisOptions } from 'ioredis'; // For advanced ioredis options

async function main() {
    // 1. 配置 Redis 连接选项
    const redisConnectionOptions: IConnectionOptions = {
        host: 'localhost', // 你的 Redis 服务器地址
        port: 6379,        // 你的 Redis 服务器端口
        // password: 'your-redis-password', // 可选：如果你的 Redis 需要密码
        // db: 0,                           // 可选：Redis 数据库编号，默认为 0
    };

    // 可选：额外的 ioredis 特定选项
    const advancedRedisOpts: RedisOptions = {
        // keyPrefix: 'casbin_policies:', // 示例：为所有 Casbin 相关的键添加前缀
        // enableOfflineQueue: false,    // 示例：禁用离线队列
    };

    // 2. 创建一个适配器实例
    // ioredis 选项的第二个参数是可选的
    const adapter = await IoRedisAdapter.newAdapter(redisConnectionOptions, advancedRedisOpts);
    // const adapter = await IoRedisAdapter.newAdapter(redisConnectionOptions); // 不带高级选项

    // 3. 创建一个 Casbin Enforcer 实例
    // 将 'path/to/your/model.conf' 替换为你的 Casbin 模型文件的实际路径
    const modelPath = path.resolve(__dirname, 'model.conf'); // 示例：model.conf 在同一目录下
    const enforcer: Enforcer = await newEnforcer(modelPath, adapter);

    // 4. 使用 Enforcer 实例
    // 当 Enforcer 初始化时，策略通常会从 Redis 加载。
    // 如果你需要显式重新加载策略（例如，在 Redis 发生外部更改后），你可以使用：
    // await enforcer.loadPolicy();

    // 添加策略
    // 这些策略将由适配器自动保存到 Redis
    await enforcer.addPolicy('alice', 'data1', 'read');
    await enforcer.addPolicy('bob', 'data2', 'write');
    await enforcer.addGroupingPolicy('charlie', 'admin'); // 用于用户角色映射的 'g' 策略

    console.log('策略已添加。');

    // 检查权限
    const aliceCanReadData1 = await enforcer.enforce('alice', 'data1', 'read');
    console.log('Alice 可以读取 data1:', aliceCanReadData1); // 预期: true

    const bobCanReadData1 = await enforcer.enforce('bob', 'data1', 'read');
    console.log('Bob 可以读取 data1:', bobCanReadData1); // 预期: false

    const charlieIsAdmin = await enforcer.hasRoleForUser('charlie', 'admin');
    console.log('Charlie 是一个管理员:', charlieIsAdmin); // 预期: true

    // 获取所有 'p' (策略) 规则
    console.log('所有 p 策略:', await enforcer.getPolicy());
    // 获取所有 'g' (分组/角色) 规则
    console.log('所有 g 策略:', await enforcer.getGroupingPolicy());

    // 删除一个策略
    await enforcer.removePolicy('bob', 'data2', 'write');
     console.log('Bob 对 data2 的写策略已删除。');
    const bobCanWriteData2AfterRemove = await enforcer.enforce('bob', 'data2', 'write');
    console.log('删除后 Bob 是否可以写 data2:', bobCanWriteData2AfterRemove); // 预期: false

    // 如果你想用 Enforcer 模型的当前状态完全覆盖 Redis 中的所有策略
    // （例如，从文件加载策略然后保存到 Redis），你可以使用：
    // await enforcer.savePolicy();
    // 注意：当在 Enforcer 上调用 addPolicy, removePolicy 等方法时，
    // 会触发适配器的相应方法，这些方法会增量保存更改。

    // 5. 当你的应用程序关闭时，关闭 Redis 连接
    // 这对于释放资源很重要。
    await adapter.close();
    console.log('Redis connection closed.');
}

main().catch(error => {
    console.error('An error occurred:', error);
});
```

## API

IoRedisAdapter 实现了 Casbin 的 FilteredAdapter 接口。主要方法包括：

- static async newAdapter(options: IConnectionOptions, redisOpts?: RedisOptions): Promise<IoRedisAdapter>
  - 用于创建和初始化适配器实例的工厂方法。
  - options: 基本的 Redis 连接详情 (host, port, password, db)。
  - redisOpts: 可选的高级 ioredis 特定选项。
- async loadPolicy(model: Model): Promise<void>
  - 从 Redis 加载所有策略规则到 Casbin 模型中。
- async loadFilteredPolicy(model: Model, filter: Filter): Promise<void>
  - L根据提供的过滤器从 Redis 加载符合条件的策略规则到 Casbin 模型中。
- async savePolicy(model: Model): Promise<boolean>
  - 将 Casbin 模型中的所有策略规则保存到 Redis。这将覆盖 Redis 中指定键下的所有现有策略。
- async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void>
  - 向 Redis 添加单条策略规则。更改会立即持久化。
- async removePolicy(sec: string, ptype: string, rule: string[]): Promise<void>
  - 从 Redis 移除单条策略规则。更改会立即持久化。
- async removeFilteredPolicy(sec: string, ptype: string, fieldIndex: number, ...fieldValues: string[]): Promise<void>
  - 从 Redis 移除符合给定过滤条件的策略规则。更改会立即持久化。
- isFiltered(): boolean
  - 如果适配器当前处于筛选状态（即已调用 loadFilteredPolicy 且未加载所有策略），则返回 true。
- async close(): Promise<void>
  - 关闭底层的 ioredis 连接。在应用程序关闭时调用此方法以释放资源非常重要。

## 工作原理
此适配器将所有 Casbin 策略（包括用于策略规则的 p 和用于分组/角色规则的 g）序列化为一个 JSON 数组，并将其存储在 Redis 中的一个特定键下。默认情况下，此键为 'policies'。

当调用 addPolicy、removePolicy 或 removeFilteredPolicy 时，适配器会更新其内存中的策略缓存，然后用更新后的列表覆盖 Redis 中的整个 'policies' 键。

当调用 savePolicy 时，所有策略都从 Casbin Model 对象中读取，然后这个完整的集合会覆盖 Redis 中的 'policies' 键。loadPolicy 从 'policies' 键读取整个列表。 

这种方法简单直接，但意味着每次修改都会重新序列化整个策略集并发送到 Redis。对于非常大的策略集或极高的写入负载，这可能会产生性能影响。

## License

本项目采用 MIT 许可证 - 详情请参阅 LICENSE 文件。本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](./LICENSE) 文件。