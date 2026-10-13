---
title: "数据库分库分表：什么时候做？怎么做？"
pubDate: 2026-03-23
category: backend
tags: []
summary: "数据库分库分表：什么时候做？怎么做？ 一、为什么需要分库分表？ 1.1 单库单表的瓶颈 指标 瓶颈值 现象 单表数据量 > 5000 万 查询明显变慢 单库连接数 > 2000 连接池耗尽 单表大小 "
draft: false
juejin:
  id: "7619709755054686249"
  url: https://juejin.cn/post/7619709755054686249
  views: 144
  likes: 0

---
## 数据库分库分表：什么时候做？怎么做？

> 当单表数据量突破千万、查询变慢、写入卡顿，是时候考虑分库分表了。本文从时机判断到实战落地，全面解析分库分表技术。

* * *

### 一、为什么需要分库分表？

#### 1.1 单库单表的瓶颈

| 指标 | 瓶颈值 | 现象 |
| --- | --- | --- |
| 单表数据量 | \> 5000 万 | 查询明显变慢 |
| 单库连接数 | \> 2000 | 连接池耗尽 |
| 单表大小 | \> 100GB | DDL 操作极慢 |
| QPS | \> 10000 | 响应时间增长 |

**实际案例**：

```sql
-- 单表 1 亿数据
SELECT * FROM orders WHERE user_id = 12345;
-- 执行时间：5 秒+
```

#### 1.2 瓶颈来源

```css
┌─────────────────────────────────────────────┐
│              单库单表瓶颈                    │
├─────────────────────────────────────────────┤
│ 1. B+ 树深度增加 → 磁盘 IO 增加             │
│ 2. 索引维护成本高 → 写入变慢               │
│ 3. 锁竞争激烈 → 并发下降                   │
│ 4. 内存无法缓存全部数据 → 缓存命中率低     │
│ 5. 备份恢复时间长 → 运维压力大             │
└─────────────────────────────────────────────┘
```

* * *

### 二、什么时候做分库分表？

#### 2.1 判断标准

```markdown
# 分库分表 Checklist
必须分：
  - 单表数据量 > 5000 万
  - 单库 QPS > 10000
  - 慢 SQL 比例 > 1%
  - 数据增长 > 50 万/天

考虑分：
  - 单表数据量 2000-5000 万
  - 单库 QPS 5000-10000
  - 关键业务需要更高性能

暂不分：
  - 单表数据量 < 2000 万
  - 优先考虑：索引优化、缓存、读写分离
```

#### 2.2 决策流程

```markdown
数据量 > 2000 万？
    ├── 否 → 索引优化 + 缓存
    └── 是 → 读多写少？
                ├── 是 → 读写分离
                └── 否 → QPS > 10000？
                            ├── 否 → 垂直拆分（分表）
                            └── 是 → 水平拆分（分库分表）
```

#### 2.3 分库 vs 分表

| 方案 | 适用场景 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **只分表** | 单库性能够，单表数据大 | 实现简单 | 单库有上限 |
| **只分库** | 单表数据不大，连接数不够 | 分散压力 | 跨库 Join |
| **分库分表** | 数据量大 + 并发高 | 全面解决 | 复杂度最高 |

* * *

### 三、拆分策略

#### 3.1 垂直拆分

**分库**：按业务模块拆分

```bash
Before:
┌─────────────────────────┐
│     单库 (all_db)        │
├─────────────────────────┤
│ users 表                 │
│ orders 表                │
│ products 表              │
│ logs 表                  │
└─────────────────────────┘

After:
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ user_db  │ │ order_db │ │prod_db   │ │ log_db   │
├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤
│ users    │ │ orders   │ │ products │ │ logs     │
│ ...      │ │ ...      │ │ ...      │ │ ...      │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**分表**：按字段拆分（冷热分离）

```bash
Before:
┌──────────────────────────────────┐
│           users 表                │
├──────────────────────────────────┤
│ id, name, email, phone,          │
│ avatar, bio, last_login,         │
│ created_at, settings...          │
│ (50+ 字段)                        │
└──────────────────────────────────┘

After:
┌─────────────────┐ ┌─────────────────┐
│   users_base    │ │   users_profile │
├─────────────────┤ ├─────────────────┤
│ id, name,       │ │ id, avatar, bio │
│ email, phone,   │ │ settings...     │
│ last_login      │ │ (冷数据)         │
│ (热数据)         │ └─────────────────┘
└─────────────────┘
```

#### 3.2 水平拆分

**核心问题**：数据如何均匀分布？

```yaml
单表 1 亿数据 → 拆成 10 张表 → 每表 1000 万
```

* * *

### 四、分片键选择（关键！）

#### 4.1 分片键选择原则

| 原则 | 说明 |
| --- | --- |
| 数据均匀 | 避免数据倾斜 |
| 查询高效 | 大部分查询能定位到具体分片 |
| 扩展性好 | 新增分片时迁移数据少 |

#### 4.2 常见分片键

```ini
// 1. 用户 ID 分片（适合 C 端业务）
shardingKey = userId
table_0: userId % 10 == 0
table_1: userId % 10 == 1
...

// 2. 订单 ID 分片（适合订单场景）
shardingKey = orderId
table_0: orderId.hashCode() % 10 == 0

// 3. 时间分片（适合日志、流水）
shardingKey = createTime
table_202401: 2024-01 的数据
table_202402: 2024-02 的数据
```

#### 4.3 分片键选择策略

```arduino
// 场景分析
public ShardingKey chooseShardingKey(String queryType) {
    switch (queryType) {
        case "用户查询订单":
            return userId;  // 用户维度
        case "商家查询订单":
            return merchantId;  // 商家维度
        case "订单详情":
            return orderId;  // 订单维度
        default:
            return createTime;  // 时间维度
    }
}

// 多维度查询怎么办？
// 方案一：冗余数据（空间换时间）
// 方案二：异构索引表（映射表）
// 方案三：使用 Elasticsearch
```

* * *

### 五、分片算法

#### 5.1 Hash 取模

```arduino
public String getTableName(long userId, int shardingCount) {
    return "user_" + (userId % shardingCount);
}

// 问题：扩容时数据迁移量大
// user_0 → user_00, user_01
// user_1 → user_10, user_11
```

#### 5.2 一致性 Hash

```ini
public class ConsistentHash {
    
    private TreeMap<Integer, String> ring = new TreeMap<>();
    private int virtualNodes = 150;  // 虚拟节点数
    
    public ConsistentHash(List<String> nodes) {
        for (String node : nodes) {
            for (int i = 0; i < virtualNodes; i++) {
                String virtualNode = node + "#" + i;
                int hash = hash(virtualNode);
                ring.put(hash, node);
            }
        }
    }
    
    public String getNode(String key) {
        int hash = hash(key);
        Map.Entry<Integer, String> entry = ring.ceilingEntry(hash);
        if (entry == null) {
            entry = ring.firstEntry();
        }
        return entry.getValue();
    }
    
    private int hash(String key) {
        return Math.abs(key.hashCode());
    }
}

// 优点：扩容时只需迁移 1/N 的数据
```

#### 5.3 范围分片

```typescript
// 按时间范围
public String getTableName(Date createTime) {
    SimpleDateFormat sdf = new SimpleDateFormat("yyyyMM");
    return "order_" + sdf.format(createTime);
}

// 按 ID 范围
public String getTableName(long orderId) {
    if (orderId < 10000000) return "order_0";
    if (orderId < 20000000) return "order_1";
    return "order_2";
}

// 优点：扩容简单，冷热数据分离
// 缺点：可能数据倾斜
```

#### 5.4 基因法

```arduino
// 订单 ID 包含用户 ID 的基因
// orderId = snowflakeId | (userId % 64)

public long generateOrderId(long userId) {
    long snowflakeId = snowflakeGenerator.nextId();
    long gene = userId % 64;  // 取用户 ID 后 6 位
    return (snowflakeId << 6) | gene;  // 注入基因
}

// 分片定位
public int getShardingIndex(long orderId) {
    return (int)(orderId & 0x3F);  // 取后 6 位
}

// 优点：通过 orderId 可直接定位到 userId 对应的分片
// 适用：订单表既要按 userId 查，又要按 orderId 查
```

* * *

### 六、分布式 ID 生成

#### 6.1 分库分表后的 ID 问题

```yaml
Before:
┌─────────────────┐
│   单表自增 ID    │
│   1, 2, 3...    │
└─────────────────┘

After:
┌─────────┐ ┌─────────┐ ┌─────────┐
│ table_0 │ │ table_1 │ │ table_2 │
│ ID: 1   │ │ ID: 1   │ │ ID: 1   │  ← 冲突！
│ ID: 2   │ │ ID: 2   │ │ ID: 2   │
└─────────┘ └─────────┘ └─────────┘
```

#### 6.2 解决方案

##### 方案一：UUID

```typescript
public String generateId() {
    return UUID.randomUUID().toString();
}

// 优点：简单、无冲突
// 缺点：无序、太长、索引性能差
```

##### 方案二：数据库自增（步长模式）

```sql
-- 分库 1
CREATE TABLE sequence (
    id BIGINT AUTO_INCREMENT PRIMARY KEY
) AUTO_INCREMENT=1 INCREMENT=3;

-- 分库 2
AUTO_INCREMENT=2 INCREMENT=3;

-- 分库 3
AUTO_INCREMENT=3 INCREMENT=3;

-- 结果：
-- DB1: 1, 4, 7, 10...
-- DB2: 2, 5, 8, 11...
-- DB3: 3, 6, 9, 12...
```

##### 方案三：Snowflake（推荐）

```ini
public class SnowflakeIdGenerator {
    
    private final long workerId;
    private final long datacenterId;
    private long sequence = 0;
    private long lastTimestamp = -1L;
    
    public synchronized long nextId() {
        long timestamp = System.currentTimeMillis();
        
        if (timestamp < lastTimestamp) {
            throw new RuntimeException("时钟回拨");
        }
        
        if (timestamp == lastTimestamp) {
            sequence = (sequence + 1) & 0xFFF;
            if (sequence == 0) {
                timestamp = tilNextMillis(lastTimestamp);
            }
        } else {
            sequence = 0;
        }
        
        lastTimestamp = timestamp;
        
        return ((timestamp - 1288834974657L) << 22)
             | (datacenterId << 17)
             | (workerId << 12)
             | sequence;
    }
}

// 结构：时间戳(41bit) + 数据中心(5bit) + 机器(5bit) + 序列号(12bit)
// 优点：有序、高性能、分布式
```

##### 方案四：Redis 自增

```arduino
public long generateId(String key) {
    return redisTemplate.opsForValue().increment(key);
}

// 优点：简单、高性能
// 缺点：依赖 Redis、网络开销
```

* * *

### 七、分库分表实战

#### 7.1 使用 ShardingSphere

**配置文件**：

```yaml
spring:
  shardingsphere:
    datasource:
      names: ds0,ds1
      ds0:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://localhost:3306/db0
      ds1:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://localhost:3306/db1
    
    rules:
      sharding:
        tables:
          t_order:
            actual-data-nodes: ds$->{0..1}.t_order_$->{0..15}
            table-strategy:
              standard:
                sharding-column: order_id
                sharding-algorithm-name: order-inline
            key-generate-strategy:
              column: order_id
              key-generator-name: snowflake
        
        sharding-algorithms:
          order-inline:
            type: INLINE
            props:
              algorithm-expression: t_order_$->{order_id % 16}
        
        key-generators:
          snowflake:
            type: SNOWFLAKE
            props:
              worker-id: 1
```

**Java 代码**：

```typescript
@Service
public class OrderService {
    
    @Autowired
    private OrderMapper orderMapper;
    
    public void createOrder(Order order) {
        // ShardingSphere 自动分片
        orderMapper.insert(order);
    }
    
    public List<Order> queryByUserId(Long userId) {
        // 自动路由到正确的分片
        return orderMapper.selectByUserId(userId);
    }
}
```

#### 7.2 全局表（广播表）

```yaml
# 全局表：每个库都有一份完整数据
shardingsphere:
  rules:
    sharding:
      broadcast-tables:
        - t_region
        - t_config
```

```scss
// 写入时自动广播到所有库
regionMapper.insert(region);  // 写入 ds0 和 ds1
```

#### 7.3 绑定表（关联分片）

```yaml
# 绑定表：关联查询优化
shardingsphere:
  rules:
    sharding:
      binding-tables:
        - t_order,t_order_item
```

```sql
-- 绑定后，关联查询可避免笛卡尔积
SELECT * FROM t_order o 
JOIN t_order_item i ON o.order_id = i.order_id
WHERE o.user_id = 123;
-- 只查询 user_id 对应的分片，而不是所有分片组合
```

* * *

### 八、常见问题解决

#### 8.1 跨库 Join

**问题**：

```vbnet
SELECT * FROM orders o 
JOIN users u ON o.user_id = u.id
-- orders 和 users 在不同库，无法 Join
```

**解决方案**：

```scss
// 方案一：应用层组装
public OrderDetail getOrderDetail(Long orderId) {
    Order order = orderMapper.selectById(orderId);
    User user = userMapper.selectById(order.getUserId());
    return new OrderDetail(order, user);
}

// 方案二：冗余数据
// 在 order 表冗余 user_name 字段

// 方案三：使用 Elasticsearch
// 将关联数据同步到 ES
```

#### 8.2 跨库事务

**问题**：

```typescript
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);      // 库 A
    inventoryMapper.deduct(item);   // 库 B
    // 一个成功一个失败，无法回滚
}
```

**解决方案**：

```typescript
// 方案一：最终一致性（推荐）
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    // 发送消息到 MQ
    mqTemplate.send("inventory-deduct", order);
}

// 方案二：Seata 分布式事务
@GlobalTransactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    inventoryMapper.deduct(item);
}
```

#### 8.3 分页查询

**问题**：

```sql
-- 单库分页
SELECT * FROM orders ORDER BY create_time DESC LIMIT 100, 20;

-- 分库后：需要从每个库取 top 120，再合并
```

**解决方案**：

```scss
public Page<Order> queryOrders(int pageNum, int pageSize) {
    // 方案一：应用层合并（小数据量）
    List<Order> all = new ArrayList<>();
    for (String ds : dataSources) {
        List<Order> part = orderMapper.selectPage(ds, pageNum * pageSize, pageSize);
        all.addAll(part);
    }
    Collections.sort(all, Comparator.comparing(Order::getCreateTime).reversed());
    return all.subList(0, Math.min(pageSize, all.size()));
    
    // 方案二：使用 Elasticsearch（推荐）
    // 方案三：禁止深分页（限制最大页数）
}
```

#### 8.4 扩容方案

**场景**：从 4 个分片扩展到 8 个分片

```scss
// 方案一：停服迁移
// 1. 停服
// 2. 全量数据迁移
// 3. 修改分片配置
// 4. 启动服务

// 方案二：双写迁移（推荐）
// 1. 修改代码：新数据同时写旧分片和新分片
// 2. 历史数据异步迁移
// 3. 验证新旧数据一致
// 4. 切换读流量到新分片
// 5. 停止写旧分片

public void insert(Order order) {
    // 双写
    oldOrderMapper.insert(order);
    newOrderMapper.insert(order);
}
```

* * *

### 九、最佳实践

#### 9.1 分片数量选择

| 数据规模 | 推荐分片数 | 单片数据量 |
| --- | --- | --- |
| < 5000 万 | 不分片 | - |
| 5000 万 - 5 亿 | 8-16 | 500 万 - 3000 万 |
| 5 亿 - 50 亿 | 32-64 | 1000 万 - 1500 万 |
| \> 50 亿 | 128+ | < 5000 万 |

#### 9.2 监控指标

```markdown
# 监控配置
metrics:
  - 分片数据量分布（是否倾斜）
  - 分片 QPS 分布
  - 慢查询数量
  - 分布式事务成功率
  - ID 生成器性能
```

#### 9.3 运维建议

```ini
运维 Checklist:
  - [ ] 分片前做数据备份
  - [ ] 分片后验证数据一致性
  - [ ] 监控各分片负载均衡
  - [ ] 制定扩容预案
  - [ ] 准备数据迁移工具
  - [ ] 设置慢查询告警
```

* * *

### 十、面试高频问题

1.  **什么时候该分库分表？**
    
    1.  单表 > 5000 万、QPS > 10000、索引优化无效时
2.  **分片键怎么选？**
    
    1.  查询频率高、数据分布均匀、业务场景匹配
3.  **分库分表后 ID 怎么生成？**
    
    1.  Snowflake 雪花算法（推荐）、UUID、Redis 自增
4.  **跨库 Join 怎么办？**
    
    1.  应用层组装、数据冗余、使用 ES
5.  **如何保证分片数据均衡？**
    
    1.  选择合适的分片键、一致性 Hash、监控迁移

* * *

### 写在最后

分库分表是架构演进的必经之路，但不要过早优化。记住：

-   能不分就不分，优先索引优化、读写分离
-   分之前做好规划，分片键是核心
-   分之后处理好跨库问题

希望这篇文章能帮你在分库分表的路上少走弯路！
