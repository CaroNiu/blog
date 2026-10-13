---
title: "分布式事务解决方案：2PC、3PC、TCC、Saga"
date: 2026-03-20
updated: 2026-03-20
categories:
  - 后端进阶
  - 支付与一致性
tags: []
description: "一、为什么需要分布式事务？ 1.1 单机事务 vs 分布式事务 单机事务（ACID）： 分布式 场景： 问题：三个独立数据库如何保证要么全部成功，要么全部失败？ 1.2 分布式事务的困境 挑战 描述 "
juejin:
  id: "7618852263628947519"
  url: https://juejin.cn/post/7618852263628947519
  views: 159
  likes: 1
---

## 一、为什么需要分布式事务？

### 1.1 单机事务 vs 分布式事务

**单机事务**（ACID）：

```sql
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;  -- 扣款
UPDATE account SET balance = balance + 100 WHERE id = 2;  -- 加款
COMMIT;
```

**分布式** **场景**：

```
订单服务 → 订单数据库
库存服务 → 库存数据库
账户服务 → 账户数据库
```

**问题**：三个独立数据库如何保证要么全部成功，要么全部失败？

### 1.2 分布式事务的困境

| 挑战 | 描述 |
| --- | --- |
| 网络不可靠 | 网络分区、延迟、丢包 |
| 数据一致性 | 多节点数据需要保持一致 |
| 性能问题 | 协调者通信开销大 |
| 故障恢复 | 需要处理各种故障场景 |

* * *

## 二、CAP 与 BASE 理论

### 2.1 CAP 定理

分布式系统最多同时满足其中两项：

| 特性 | 含义 | 选择 |
| --- | --- | --- |
| C (Consistency) | 一致性 | AP 或 CP |
| A (Availability) | 可用性 | CP 或 AP |
| P (Partition Tolerance) | 分区容错性 | 必须满足 |

**实际选择**：

-   **CP 系统**：Zookeeper、HBase（强一致性优先）
-   **AP 系统**：Cassandra、Eureka（可用性优先）

### 2.2 BASE 理论

既然 CAP 不可兼得，我们追求"基本可用"：

| 特性 | 含义 |
| --- | --- |
| BA (Basically Available) | 基本可用，允许损失部分可用性 |
| S (Soft State) | 软状态，允许中间状态 |
| E (Eventually Consistent) | 最终一致性，允许暂时不一致 |

**核心思想**：牺牲强一致性换取高性能和高可用

* * *

## 三、2PC：两阶段提交

### 3.1 基本原理

```sql
          协调者                    参与者 A              参与者 B
            |                         |                      |
            | -------- Phase 1 --------> |                    |
            |       PREPARE (能否提交)   |                    |
            | <------- YES/NO ----------- |                    |
            |                         |                      |
            | -------- Phase 1 --------> |                    |
            |       PREPARE              |                    |
            | <------- YES/NO ----------- |                    |
            |                         |                      |
            | -------- Phase 2 --------> |                    |
            |   COMMIT/ROLLBACK          |                    |
            | <-------- ACK ------------- |                    |
            |                         |                      |
            | -------- Phase 2 --------> |                    |
            |   COMMIT/ROLLBACK          |                    |
            | <-------- ACK ------------- |                    |
```

### 3.2 执行流程

**阶段一：准备阶段（Prepare）**

```scss
// 协调者
public void prepare() {
    for (Participant participant : participants) {
        boolean canCommit = participant.prepare();  // 询问能否提交
        if (!canCommit) {
            abort = true;
            break;
        }
    }
}

// 参与者
public boolean prepare() {
    // 1. 执行本地事务（不提交）
    executeLocalTransaction();
    
    // 2. 写 Undo/Redo 日志
    writeUndoLog();
    writeRedoLog();
    
    // 3. 锁定资源
    lockResources();
    
    return true;  // 表示可以提交
}
```

**阶段二：提交阶段（Commit/Rollback）**

```scss
// 协调者
public void commit() {
    if (abort) {
        // 任一参与者返回 NO，全局回滚
        for (Participant participant : participants) {
            participant.rollback();
        }
    } else {
        // 全部返回 YES，全局提交
        for (Participant participant : participants) {
            participant.commit();
        }
    }
}

// 参与者
public void commit() {
    // 提交本地事务
    commitLocalTransaction();
    // 释放锁
    unlockResources();
}

public void rollback() {
    // 回滚本地事务
    rollbackLocalTransaction();
    // 释放锁
    unlockResources();
}
```

### 3.3 优缺点分析

| 优点 | 缺点 |
| --- | --- |
| 实现简单 | 同步阻塞，性能差 |
| 强一致性 | 单点故障（协调者挂了） |
|  | 数据不一致（Commit 阶段协调者宕机） |

### 3.4 数据不一致场景

```css
协调者 → 发送 COMMIT → 参与者 A 提交成功
协调者 → 宕机
协调者恢复后 → 不知道是否要通知参与者 B
```

**解决方案**：协调者记录日志，重启后根据日志继续

* * *

## 四、3PC：三阶段提交

### 4.1 改进之处

在 2PC 基础上增加了 CanCommit 阶段，并引入超时机制：

```yaml
Phase 1: CanCommit（询问能否执行）
Phase 2: PreCommit（预提交）
Phase 3: DoCommit（正式提交）
```

### 4.2 执行流程

**阶段一：CanCommit**

```scss
public boolean canCommit() {
    // 检查资源是否充足、网络是否可用
    // 不执行实际业务，只检查能否执行
    return checkResources() && checkNetwork();
}
```

**阶段二：PreCommit**

```scss
public void preCommit() {
    // 执行本地事务（不提交）
    executeLocalTransaction();
    // 写预提交日志
    writePreCommitLog();
}
```

**阶段三：DoCommit**

```csharp
public void doCommit() {
    // 正式提交本地事务
    commitLocalTransaction();
}
```

### 4.3 超时机制

| 阶段 | 超时行为 |
| --- | --- |
| CanCommit | 参与者等待超时 → 中断 |
| PreCommit | 参与者等待超时 → 执行提交（避免阻塞） |
| DoCommit | 参与者等待超时 → 执行提交 |

### 4.4 3PC vs 2PC

| 特性 | 2PC | 3PC |
| --- | --- | --- |
| 阶段数 | 2 | 3 |
| 阻塞 | 是 | 否（有超时） |
| 单点故障影响 | 大 | 小 |
| 实现复杂度 | 低 | 高 |
| 极端不一致 | 可能 | 可能（概率降低） |

**结论**：3PC 并未完全解决 2PC 的问题，实际应用较少

* * *

## 五、TCC：Try-Confirm-Cancel

### 5.1 基本原理

TCC 是业务层面的分布式事务方案：

| 阶段 | 操作 | 含义 |
| --- | --- | --- |
| Try | 预留资源 | 冻结库存、冻结金额等 |
| Confirm | 确认提交 | 真正扣减库存、金额 |
| Cancel | 取消回滚 | 释放冻结资源 |

### 5.2 电商下单示例

**订单服务**：

```scss
@Service
public class OrderService {
    
    @Autowired
    private InventoryTCC inventoryTCC;
    @Autowired
    private AccountTCC accountTCC;
    
    @GlobalTransactional
    public void createOrder(Order order) {
        try {
            // Phase 1: Try（预留资源）
            inventoryTCC.tryDeduct(order.getProductId(), order.getQuantity());
            accountTCC.tryFreeze(order.getUserId(), order.getAmount());
            
            // 创建订单
            orderMapper.insert(order);
            
            // Phase 2: Confirm（确认提交）
            inventoryTCC.confirm(order.getProductId());
            accountTCC.confirm(order.getUserId());
            
        } catch (Exception e) {
            // Phase 2: Cancel（回滚）
            inventoryTCC.cancel(order.getProductId());
            accountTCC.cancel(order.getUserId());
            throw e;
        }
    }
}
```

**库存服务 TCC 实现**：

```typescript
@Service
public class InventoryTCCImpl implements InventoryTCC {
    
    @Autowired
    private InventoryMapper inventoryMapper;
    @Autowired
    private RedisTemplate redisTemplate;
    
    // Try：预留库存
    @Override
    @Transactional
    public void tryDeduct(Long productId, Integer quantity) {
        // 1. 检查库存
        Inventory inventory = inventoryMapper.selectById(productId);
        if (inventory.getAvailable() < quantity) {
            throw new BizException("库存不足");
        }
        
        // 2. 扣减可用库存，增加冻结库存
        inventoryMapper.decreaseAvailable(productId, quantity);
        inventoryMapper.increaseFrozen(productId, quantity);
        
        // 3. 记录事务上下文
        String xid = RootContext.getXID();
        redisTemplate.opsForValue().set(
            "tcc:inventory:" + xid,
            JSON.toJSONString(new InventoryLog(productId, quantity)),
            30, TimeUnit.MINUTES
        );
    }
    
    // Confirm：确认扣减
    @Override
    @Transactional
    public void confirm(Long productId) {
        String xid = RootContext.getXID();
        InventoryLog log = getInventoryLog(xid);
        
        // 将冻结库存转为实际扣减
        inventoryMapper.decreaseFrozen(productId, log.getQuantity());
        inventoryMapper.increaseSold(productId, log.getQuantity());
        
        // 清理日志
        redisTemplate.delete("tcc:inventory:" + xid);
    }
    
    // Cancel：释放库存
    @Override
    @Transactional
    public void cancel(Long productId) {
        String xid = RootContext.getXID();
        InventoryLog log = getInventoryLog(xid);
        
        // 恢复可用库存，减少冻结库存
        inventoryMapper.increaseAvailable(productId, log.getQuantity());
        inventoryMapper.decreaseFrozen(productId, log.getQuantity());
        
        // 清理日志
        redisTemplate.delete("tcc:inventory:" + xid);
    }
}
```

### 5.3 TCC 的优缺点

| 优点 | 缺点 |
| --- | --- |
| 性能较好（无全局锁） | 业务侵入性强 |
| 最终一致性 | 开发成本高（每个业务写 3 个方法） |
| 支持异步提交 | 幂等性问题 |
| 支持超时回滚 | 悬挂问题 |

### 5.4 幂等性与悬挂问题

**幂等性**：

```typescript
// Confirm/Cancel 需要保证幂等
@Override
public void confirm(Long productId) {
    String xid = RootContext.getXID();
    
    // 幂等控制：已处理过则直接返回
    if (redisTemplate.hasKey("tcc:confirmed:" + xid)) {
        return;
    }
    
    // 执行业务
    inventoryMapper.decreaseFrozen(productId, quantity);
    
    // 标记已处理
    redisTemplate.opsForValue().set("tcc:confirmed:" + xid, "1");
}
```

**悬挂问题**：

```vbnet
Try 超时 → 执行 Cancel → Try 到达
         → 需要拒绝迟到的 Try
```

```typescript
@Override
public void tryDeduct(Long productId, Integer quantity) {
    String xid = RootContext.getXID();
    
    // 检查是否已经 Cancel
    if (redisTemplate.hasKey("tcc:canceled:" + xid)) {
        throw new BizException("事务已取消，拒绝 Try 操作");
    }
    
    // 正常执行业务
}
```

* * *

## 六、Saga：长事务解决方案

### 6.1 基本原理

Saga 将一个长事务拆分为多个本地事务，每个事务有对应的补偿操作：

```erlang
T1 → T2 → T3 → T4 → ...
     ↑
   失败时逆序补偿
     ↓
C1 ← C2 ← C3 ← C4 ← ...
```

### 6.2 两种模式

**编排式（Choreography）** ：

```markdown
订单服务 → 完成订单 → 发送事件
                    ↓
              库存服务 → 扣减库存 → 发送事件
                                ↓
                              账户服务 → 扣款 → 发送事件
```

**编排式代码**：

```typescript
@Service
public class OrderSaga {
    
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    public void startOrderSaga(Order order) {
        // 创建订单
        orderMapper.insert(order);
        
        // 发布订单创建事件
        eventPublisher.publishEvent(new OrderCreatedEvent(order));
    }
}

// 库存服务监听
@Component
public class InventoryHandler {
    
    @EventListener
    @Transactional
    public void onOrderCreated(OrderCreatedEvent event) {
        try {
            inventoryMapper.deduct(event.getProductId(), event.getQuantity());
            eventPublisher.publishEvent(new InventoryDeductedEvent(event));
        } catch (Exception e) {
            // 发布补偿事件
            eventPublisher.publishEvent(new InventoryCompensateEvent(event));
        }
    }
    
    @EventListener
    @Transactional
    public void compensate(InventoryCompensateEvent event) {
        inventoryMapper.restore(event.getProductId(), event.getQuantity());
    }
}
```

**协同式（Orchestration）** ：

```
Saga 编排器
   ↓
T1（订单）→ T2（库存）→ T3（账户）
   ↓
  失败时调用补偿
```

**协同式代码（使用 Seata Saga）** ：

```json
// order-saga.json
{
  "startState": "CreateOrder",
  "states": {
    "CreateOrder": {
      "type": "serviceTask",
      "serviceName": "orderService",
      "methodName": "create",
      "input": "$.[request]",
      "output": "$.[order]",
      "next": "DeductInventory"
    },
    "DeductInventory": {
      "type": "serviceTask",
      "serviceName": "inventoryService",
      "methodName": "deduct",
      "input": "$.[order]",
      "next": "DebitAccount",
      "compensateState": "CompensateInventory"
    },
    "DebitAccount": {
      "type": "serviceTask",
      "serviceName": "accountService",
      "methodName": "debit",
      "input": "$.[order]",
      "next": "Succeed",
      "compensateState": "CompensateAccount"
    },
    "CompensateInventory": {
      "type": "serviceTask",
      "serviceName": "inventoryService",
      "methodName": "restore"
    },
    "CompensateAccount": {
      "type": "serviceTask",
      "serviceService": "accountService",
      "methodName": "credit"
    },
    "Succeed": {
      "type": "succeed"
    }
  }
}
```

### 6.3 Saga 的优缺点

| 优点 | 缺点 |
| --- | --- |
| 无全局锁，性能好 | 最终一致性 |
| 支持长事务 | 补偿逻辑复杂 |
| 高可用 | 业务侵入性 |
| 适合微服务 | 隔离性问题 |

### 6.4 隔离性问题

Saga 没有全局锁，可能出现：

-   **脏读**：读到未提交的中间状态
-   **丢失更新**：两个 Saga 同时修改同一数据

**解决方案**：

-   **语义锁**：业务层面加锁
-   **悲观视图**：读取时检查是否有补偿中
-   **交换式更新**：设计业务避免冲突

* * *

## 七、四种方案对比

| 特性 | 2PC | 3PC | TCC | Saga |
| --- | --- | --- | --- | --- |
| **一致性** | 强一致 | 强一致 | 最终一致 | 最终一致 |
| **性能** | 低 | 低 | 高 | 高 |
| **复杂度** | 低 | 中 | 高 | 中 |
| **业务侵入** | 无 | 无 | 高 | 中 |
| **适用场景** | 单体数据库 | 少用 | 金融支付 | 长事务业务 |
| **典型实现** | XA | - | Seata | Seata、Axon |

* * *

## 八、方案选择指南

### 8.1 决策树

```markdown
需要强一致性？
    ├── 是 → 数据量小？
    │            ├── 是 → 2PC/XA
    │            └── 否 → TCC（牺牲部分一致性）
    └── 否 → 事务周期长？
                 ├── 是 → Saga
                 └── 否 → TCC
```

### 8.2 场景推荐

| 业务场景 | 推荐方案 | 理由 |
| --- | --- | --- |
| 电商下单 | TCC | 性能要求高，可接受最终一致 |
| 银行转账 | TCC/2PC | 强一致要求，数据敏感 |
| 物流流程 | Saga | 长事务，多步骤 |
| 积分扣减 | 最终一致性 | 可异步，低延迟要求 |
| 库存扣减 | TCC + 缓存 | 高并发，性能优先 |

* * *

## 九、Seata 实战

### 9.1 Seata 架构

```scss
TC (Transaction Coordinator)  事务协调器
├── 维护全局事务和分支事务状态
├── 驱动全局提交或回滚
└── 需要独立部署

TM (Transaction Manager)  事务管理器
├── 开启全局事务
├── 提交或回滚全局事务
└── 集成在业务代码中

RM (Resource Manager)  资源管理器
├── 管理分支事务资源
├── 驱动分支事务提交或回滚
└── 集成在数据源中
```

### 9.2 集成步骤

**Step 1：引入依赖**

```xml
<dependency>
    <groupId>io.seata</groupId>
    <artifactId>seata-spring-boot-starter</artifactId>
    <version>1.7.0</version>
</dependency>
```

**Step 2：配置 TC 地址**

```yaml
seata:
  enabled: true
  application-id: ${spring.application.name}
  tx-service-group: my_tx_group
  service:
    vgroup-mapping:
      my_tx_group: default
  client:
    rm:
      async-commit-buffer-limit: 10000
```

**Step 3：开启全局事务**

```scss
@Service
public class OrderService {
    
    @Autowired
    private StorageFeignClient storageFeignClient;
    @Autowired
    private AccountFeignClient accountFeignClient;
    
    @GlobalTransactional(name = "create-order", rollbackFor = Exception.class)
    public void createOrder(Order order) {
        // 本地操作
        orderMapper.insert(order);
        
        // 调用库存服务
        storageFeignClient.deduct(order.getProductId(), order.getCount());
        
        // 调用账户服务
        accountFeignClient.debit(order.getUserId(), order.getMoney());
        
        // 任一服务失败，自动回滚
    }
}
```

### 9.3 四种模式支持

| Seata 模式 | 实现方式 |
| --- | --- |
| AT 模式 | 自动补偿，代理数据源 |
| TCC 模式 | 需要实现 Try/Confirm/Cancel |
| SAGA 模式 | JSON 状态机或注解 |
| XA 模式 | 标准的 2PC |

* * *

## 十、面试高频问题

1.  **分布式事务有哪些解决方案？**
    
    1.  2PC/3PC、TCC、Saga、本地消息表、MQ 事务消息
2.  **2PC 和 TCC 的区别？**
    
    1.  2PC 是资源层（数据库层面），TCC 是业务层
    2.  2PC 阻塞，TCC 不阻塞
    3.  TCC 性能更好，但开发成本高
3.  **TCC 的悬挂问题是什么？如何解决？**
    
    1.  Try 超时后执行 Cancel，然后 Try 到达
    2.  解决：记录 Cancel 状态，拒绝迟到的 Try
4.  **Saga 和 TCC 如何选择？**
    
    1.  Saga：长事务、多步骤、最终一致性
    2.  TCC：短事务、性能要求高、资源预留
5.  **Seata 的 AT 模式原理？**
    
    1.  代理数据源，拦截 SQL
    2.  生成 Undo Log
    3.  全局事务回滚时，根据 Undo Log 反向补偿

* * *

## 写在最后

分布式事务没有银弹，选择方案时需要权衡：

-   **一致性要求**：强一致还是最终一致？
-   **性能要求**：能否接受性能损耗？
-   **开发成本**：业务侵入性能否接受？
-   **运维复杂度**：是否好维护？

**实践建议**：

1.  优先用最终一致性方案（消息队列、Saga）
2.  强一致场景用 TCC
3.  尽量规避分布式事务（服务划分合理）

希望这篇文章能帮你理清分布式事务的选择思路！
