---
title: "分布式事务学习与实际项目接入选型"
pubDate: 2026-04-03
category: practice
series: 支付与一致性
tags: []
summary: "一、理论基础：为什么需要分布式事务 1.1 问题场景 单体架构时代： 微服务架构 时代： 典型场景： 订单+库存+优惠券 支付+订单+积分 转账（A账户扣款+B账户入账） 分布式锁+业务操作 1.2 "
draft: false
juejin:
  id: "7624024070773112868"
  url: https://juejin.cn/post/7624024070773112868
  views: 170
  likes: 0

---
## 一、理论基础：为什么需要分布式事务

### 1.1 问题场景

**单体架构时代**：

```scss
@Transactional
public void createOrder(OrderRequest request) {
    // 本地事务，单库操作，ACID保证
    orderMapper.insert(order);           // 订单表
    inventoryMapper.reduceStock(skuId, qty);  // 库存表
    couponMapper.useCoupon(couponId);    // 优惠券表
    // 要么全成功，要么全回滚
}
```

**微服务架构** **时代**：

```
订单服务          库存服务          优惠券服务
   │                │                │
   ├─创建订单──────→├─扣减库存       │
   │                │                │
   │                ├─库存不足！回滚→│
   │                │                │
   └─订单已创建！无法回滚───────────→└─使用优惠券
   
❌ 问题：订单创建成功，但库存扣减失败，数据不一致！
```

**典型场景**：

-   订单+库存+优惠券
-   支付+订单+积分
-   转账（A账户扣款+B账户入账）
-   分布式锁+业务操作

### 1.2 CAP定理与BASE理论

#### CAP定理

分布式系统最多只能同时满足以下三项中的两项：

| 特性 | 含义 | 说明 |
| --- | --- | --- |
| **C**onsistency | 一致性 | 所有节点在同一时间看到相同数据 |
| **A**vailability | 可用性 | 每个请求都能在合理时间内得到响应 |
| **P**artition tolerance | 分区容错 | 网络分区时系统仍能运行 |

**实际选择**：

-   网络分区不可避免 → **P必须选**
    
-   一致性和可用性二选一：
    
    -   CP：银行转账（强一致，可能不可用）
    -   AP：社交点赞（高可用，最终一致）

#### BASE理论

BASE是对CAP的补充，适用于AP系统：

| 特性 | 含义 |
| --- | --- |
| **B**asically **A**vailable | 基本可用，允许降级 |
| **S**oft state | 软状态，中间状态可被感知 |
| **E**ventually consistent | 最终一致，一段时间后达到一致 |

**核心思想**：不强求实时一致，通过补偿机制达到最终一致。

### 1.3 一致性级别对比

| 级别 | 描述 | 典型场景 | 性能 |
| --- | --- | --- | --- |
| 强一致 | 写入后立即可读最新值 | 银行账户、库存扣减 | 低 |
| 最终一致 | 写入后延迟可读最新值 | 订单状态、积分同步 | 高 |
| 因果一致 | 有因果关系的操作顺序一致 | 评论回复、消息队列 | 中 |
| 会话一致 | 同一会话内读写一致 | 用户个人中心 | 中 |

* * *

## 二、分布式事务模式详解

### 2.1 2PC（两阶段提交）

#### 原理

```sql
协调者                  参与者A           参与者B
   │                      │                 │
   ├─────Prepare─────────→│                 │
   │                      ├─锁定资源        │
   │                      ├─返回Ready──────→│
   │                      │                 │
   ├─────────────────Prepare───────────────→│
   │                      │                 ├─锁定资源
   │                      │                 ├─返回Ready
   │←─────────────────────┴─────────────────┤
   │                                        │
   ├─────Commit───────────→│                 │
   │                      ├─提交事务        │
   │                      │                 │
   ├─────────────────Commit────────────────→│
   │                      │                 ├─提交事务
```

#### 阶段说明

**Phase 1: Prepare（准备阶段）**

1.  协调者向所有参与者发送Prepare请求
2.  参与者执行本地事务，但不提交
3.  参与者锁定资源，返回Ready/Abort

**Phase 2: Commit/Rollback（提交/回滚阶段）**

-   全部Ready → 发送Commit
-   任一Abort → 发送Rollback

#### 代码示例（伪代码）

```typescript
// 协调者
public class TransactionCoordinator {
    
    public boolean commit() {
        // Phase 1: Prepare
        List<Participant> participants = getParticipants();
        List<Boolean> prepareResults = new ArrayList<>();
        
        for (Participant p : participants) {
            boolean ready = p.prepare();
            prepareResults.add(ready);
        }
        
        // Phase 2: Commit or Rollback
        if (prepareResults.stream().allMatch(r -> r)) {
            // 全部准备成功，提交
            participants.forEach(Participant::commit);
            return true;
        } else {
            // 有失败，回滚
            participants.forEach(Participant::rollback);
            return false;
        }
    }
}

// 参与者
public class InventoryParticipant implements Participant {
    
    @Override
    public boolean prepare() {
        try {
            // 锁定库存，但不实际扣减
            return inventoryMapper.lockStock(skuId, qty) > 0;
        } catch (Exception e) {
            return false;
        }
    }
    
    @Override
    public void commit() {
        // 真正扣减库存
        inventoryMapper.reduceLockedStock(skuId, qty);
    }
    
    @Override
    public void rollback() {
        // 释放锁定
        inventoryMapper.unlockStock(skuId, qty);
    }
}
```

#### 优缺点

| 优点 | 缺点 |
| --- | --- |
| 强一致性 | 同步阻塞，性能差 |
| 实现相对简单 | 协调者单点故障 |
| 适合数据库层面 | 锁定资源时间长 |
|  | 网络分区时可能数据不一致 |

#### 适用场景

-   单体应用多数据源
-   数据库分布式事务（XA协议）
-   对一致性要求极高的场景

* * *

### 2.2 TCC（Try-Confirm-Cancel）

#### 原理

```vbnet
业务调用方              TCC框架           库存服务           订单服务
     │                    │                 │                 │
     ├─发起分布式事务────→│                 │                 │
     │                    │                 │                 │
     │                    ├────Try─────────→│                 │
     │                    │                 ├─冻结库存(100)   │
     │                    │←────OK──────────┤                 │
     │                    │                 │                 │
     │                    ├─────────────Try─────────────────→│
     │                    │                 │                 ├─创建待确认订单
     │                    │←──────────────────────────────OK─┤
     │                    │                 │                 │
     │                    ├───Confirm──────→│                 │
     │                    │                 ├─扣减冻结库存    │
     │                    │                 │                 │
     │                    ├──────────Confirm────────────────→│
     │                    │                 │                 ├─订单状态→已创建
     │                    │                 │                 │
     │←─────事务完成───────┤                 │                 │
```

#### 三阶段详解

| 阶段 | 操作 | 库存服务示例 | 订单服务示例 |
| --- | --- | --- | --- |
| **Try** | 资源预留/检查 | 冻结库存（stock_frozen +100） | 创建待确认订单（status=PENDING） |
| **Confirm** | 确认执行 | 扣减冻结库存（stock -100, stock_frozen -100） | 订单状态→已创建 |
| **Cancel** | 取消执行 | 释放冻结库存（stock_frozen -100） | 删除待确认订单 |

#### 完整代码示例

**库存服务 - TCC实现**：

```ini
public interface InventoryTccService {
    
    /**
     * Try: 冻结库存
     * @param xid 全局事务ID
     * @param skuId 商品ID
     * @param qty 数量
     * @return 是否成功
     */
    @TwoPhaseBusinessAction(name = "inventoryTcc", 
                            commitMethod = "confirm", 
                            rollbackMethod = "cancel")
    boolean tryFreeze(@BusinessActionContextParameter(paramName = "xid") String xid,
                      @BusinessActionContextParameter(paramName = "skuId") Long skuId,
                      @BusinessActionContextParameter(paramName = "qty") Integer qty);
    
    /**
     * Confirm: 真正扣减
     */
    boolean confirm(BusinessActionContext context);
    
    /**
     * Cancel: 释放冻结
     */
    boolean cancel(BusinessActionContext context);
}

@Service
public class InventoryTccServiceImpl implements InventoryTccService {
    
    @Autowired
    private InventoryMapper inventoryMapper;
    
    @Autowired
    private InventoryFreezeMapper freezeMapper;
    
    @Override
    @Transactional
    public boolean tryFreeze(String xid, Long skuId, Integer qty) {
        // 1. 检查库存是否充足
        Inventory inventory = inventoryMapper.selectBySkuId(skuId);
        if (inventory.getAvailableStock() < qty) {
            throw new BusinessException("库存不足");
        }
        
        // 2. 冻结库存（预留资源）
        inventoryMapper.freezeStock(skuId, qty);
        // UPDATE inventory SET available_stock = available_stock - ?, 
        //                      frozen_stock = frozen_stock + ?
        // WHERE sku_id = ?
        
        // 3. 记录冻结流水（用于回滚）
        InventoryFreeze freeze = new InventoryFreeze();
        freeze.setXid(xid);
        freeze.setSkuId(skuId);
        freeze.setQty(qty);
        freeze.setStatus(FreezeStatus.FROZEN);
        freezeMapper.insert(freeze);
        
        return true;
    }
    
    @Override
    @Transactional
    public boolean confirm(BusinessActionContext context) {
        String xid = context.getXid();
        Long skuId = context.getActionContext("skuId", Long.class);
        Integer qty = context.getActionContext("qty", Integer.class);
        
        // 1. 查询冻结记录
        InventoryFreeze freeze = freezeMapper.selectByXid(xid);
        if (freeze == null || freeze.getStatus() == FreezeStatus.CONFIRMED) {
            // 幂等：已确认，直接返回成功
            return true;
        }
        
        // 2. 扣减冻结库存
        inventoryMapper.reduceFrozenStock(skuId, qty);
        // UPDATE inventory SET frozen_stock = frozen_stock - ?
        // WHERE sku_id = ?
        
        // 3. 更新冻结记录状态
        freezeMapper.updateStatus(xid, FreezeStatus.CONFIRMED);
        
        return true;
    }
    
    @Override
    @Transactional
    public boolean cancel(BusinessActionContext context) {
        String xid = context.getXid();
        Long skuId = context.getActionContext("skuId", Long.class);
        Integer qty = context.getActionContext("qty", Integer.class);
        
        // 1. 查询冻结记录
        InventoryFreeze freeze = freezeMapper.selectByXid(xid);
        if (freeze == null) {
            // 空回滚：Try未执行，直接插入一条已取消记录
            freeze = new InventoryFreeze();
            freeze.setXid(xid);
            freeze.setSkuId(skuId);
            freeze.setQty(0);
            freeze.setStatus(FreezeStatus.CANCELLED);
            freezeMapper.insert(freeze);
            return true;
        }
        
        if (freeze.getStatus() == FreezeStatus.CANCELLED) {
            // 幂等：已取消，直接返回成功
            return true;
        }
        
        // 2. 释放冻结库存
        inventoryMapper.releaseFrozenStock(skuId, qty);
        // UPDATE inventory SET available_stock = available_stock + ?,
        //                      frozen_stock = frozen_stock - ?
        // WHERE sku_id = ?
        
        // 3. 更新冻结记录状态
        freezeMapper.updateStatus(xid, FreezeStatus.CANCELLED);
        
        return true;
    }
}
```

#### TCC三大问题

**1\. 空回滚**

场景：Try未执行，Cancel被调用

```vbnet
协调者发送Try → 网络超时 → 协调者认为失败 → 发送Cancel
                          ↑
                     Try实际未到达参与者
```

解决方案：

```ini
// Cancel时检查：如果不存在冻结记录，插入一条已取消记录
if (freeze == null) {
    freeze = new InventoryFreeze();
    freeze.setXid(xid);
    freeze.setStatus(FreezeStatus.CANCELLED);
    freezeMapper.insert(freeze);
    return true;
}
```

**2\. 悬挂**

场景：Cancel先于Try执行

```vbnet
协调者发送Try → 网络延迟
协调者超时 → 发送Cancel → Cancel先到达 → 执行空回滚
Try后到达 → 尝试冻结资源 → 但事务已结束！
```

解决方案：

```java
// Try时检查：如果已存在已取消记录，拒绝执行
InventoryFreeze freeze = freezeMapper.selectByXid(xid);
if (freeze != null && freeze.getStatus() == FreezeStatus.CANCELLED) {
    return false; // 拒绝执行
}
```

**3\. 幂等性**

场景：Confirm/Cancel被重复调用

解决方案：

```kotlin
// 所有操作前都检查状态
if (freeze.getStatus() == FreezeStatus.CONFIRMED) {
    return true; // 已确认，直接返回
}
```

#### 优缺点

| 优点 | 缺点 |
| --- | --- |
| 性能好（无长时间锁） | 代码侵入性强 |
| 最终一致性 | 需要实现三个接口 |
| 资源锁定时间短 | 空回滚、悬挂问题需处理 |
| 适用范围广 | 开发成本高 |

* * *

### 2.3 Saga模式

#### 原理

将长事务拆分为多个本地短事务，每个事务有对应的补偿操作。

```makefile
正向流程: T1 → T2 → T3 → T4 (成功)
补偿流程: T1 → T2 → T3失败 → C2 → C1 (回滚)

T: 正向事务
C: 补偿事务
```

#### 两种编排方式

**1\. 编排式（Choreography）- 事件驱动**

```scss
订单服务              库存服务              支付服务
    │                    │                    │
    ├─创建订单(PENDING)  │                    │
    ├─发布OrderCreated──→│                    │
    │                    ├─扣减库存            │
    │                    ├─发布StockReduced───→│
    │                    │                    ├─扣款
    │                    │                    ├─发布PaymentSuccess
    │←─────────────────────────────────────┬─┤
    ├─更新订单状态(SUCCESS)│                    │
```

**代码示例**：

```typescript
// 订单服务
@Service
public class OrderService {
    
    @Autowired
    private OrderMapper orderMapper;
    
    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    
    public void createOrder(OrderRequest request) {
        // 创建待确认订单
        Order order = new Order();
        order.setStatus(OrderStatus.PENDING);
        orderMapper.insert(order);
        
        // 发布订单创建事件
        OrderCreatedEvent event = new OrderCreatedEvent(order.getId(), request);
        rocketMQTemplate.asyncSend("order-created", event, new SendCallback() {
            @Override
            public void onSuccess(SendResult sendResult) {
                log.info("订单创建事件发送成功: {}", order.getId());
            }
            
            @Override
            public void onException(Throwable e) {
                log.error("订单创建事件发送失败", e);
                // 回滚订单
                orderMapper.deleteById(order.getId());
            }
        });
    }
    
    // 监听支付成功事件
    @RocketMQMessageListener(topic = "payment-success", consumerGroup = "order-group")
    public void onPaymentSuccess(PaymentSuccessEvent event) {
        orderMapper.updateStatus(event.getOrderId(), OrderStatus.SUCCESS);
    }
    
    // 监听支付失败事件（补偿）
    @RocketMQMessageListener(topic = "payment-failed", consumerGroup = "order-group")
    public void onPaymentFailed(PaymentFailedEvent event) {
        orderMapper.updateStatus(event.getOrderId(), OrderStatus.CANCELLED);
        // 发布订单取消事件，触发其他服务的补偿
        rocketMQTemplate.send("order-cancelled", new OrderCancelledEvent(event.getOrderId()));
    }
}
```

**2\. 编排式（Orchestration）- 中央协调**

```markdown
Saga协调器
    │
    ├─Step1: 创建订单
    │   └─补偿: 取消订单
    │
    ├─Step2: 扣减库存
    │   └─补偿: 恢复库存
    │
    ├─Step3: 扣款
    │   └─补偿: 退款
    │
    └─Step4: 发货
        └─补偿: 取消发货
```

**代码示例（Seata Saga）** ：

```json
{
  "Name": "create-order-saga",
  "Comment": "创建订单Saga流程",
  "StartState": "CreateOrder",
  "States": {
    "CreateOrder": {
      "Type": "ServiceTask",
      "ServiceName": "orderService",
      "ServiceMethod": "create",
      "CompensateState": "CancelOrder",
      "Next": "ReduceInventory",
      "Input": ["$.orderId", "$.orderRequest"],
      "Output": {
        "orderId": "$.orderId"
      }
    },
    "ReduceInventory": {
      "Type": "ServiceTask",
      "ServiceName": "inventoryService",
      "ServiceMethod": "reduce",
      "CompensateState": "RestoreInventory",
      "Next": "Payment",
      "Input": ["$.orderRequest.skuId", "$.orderRequest.qty"]
    },
    "Payment": {
      "Type": "ServiceTask",
      "ServiceName": "paymentService",
      "ServiceMethod": "pay",
      "CompensateState": "Refund",
      "Next": "Succeed",
      "Input": ["$.orderId", "$.orderRequest.amount"]
    },
    "Succeed": {
      "Type": "Succeed"
    },
    "CancelOrder": {
      "Type": "ServiceTask",
      "ServiceName": "orderService",
      "ServiceMethod": "cancel",
      "Input": ["$.orderId"]
    },
    "RestoreInventory": {
      "Type": "ServiceTask",
      "ServiceName": "inventoryService",
      "ServiceMethod": "restore",
      "Input": ["$.orderRequest.skuId", "$.orderRequest.qty"]
    },
    "Refund": {
      "Type": "ServiceTask",
      "ServiceName": "paymentService",
      "ServiceMethod": "refund",
      "Input": ["$.orderId"]
    }
  }
}
```

#### 优缺点对比

| 方式 | 优点 | 缺点 |
| --- | --- | --- |
| 编排式（事件驱动） | 解耦、扩展性好 | 流程不直观、调试困难 |
| 编排式（中央协调） | 流程清晰、易监控 | 协调器单点、耦合度高 |

* * *

### 2.4 本地消息表

#### 原理

在本地事务中同时写入业务数据和消息记录，通过定时任务扫描并投递消息。

```ini
本地事务:
  1. 扣减库存
  2. 写入消息表（status=SENDING）
  ↑ 原子性保证

定时任务:
  扫描消息表 → 发送MQ → 更新状态(SENT)
```

#### 代码示例

**库存服务**：

```scss
@Service
public class InventoryService {
    
    @Autowired
    private InventoryMapper inventoryMapper;
    
    @Autowired
    private LocalMessageMapper messageMapper;
    
    @Transactional
    public void reduceStock(Long skuId, Integer qty, String orderId) {
        // 1. 扣减库存
        inventoryMapper.reduceStock(skuId, qty);
        
        // 2. 写入本地消息表（同一事务）
        LocalMessage message = new LocalMessage();
        message.setMessageId(UUID.randomUUID().toString());
        message.setTopic("stock-reduced");
        message.setBody(JSON.toJSONString(new StockReducedEvent(skuId, qty, orderId)));
        message.setStatus(MessageStatus.SENDING);
        message.setRetryCount(0);
        message.setCreateTime(new Date());
        messageMapper.insert(message);
    }
}
```

**消息投递任务**：

```scss
@Component
public class MessageSender {
    
    @Autowired
    private LocalMessageMapper messageMapper;
    
    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    
    @Scheduled(fixedDelay = 5000) // 每5秒执行一次
    public void sendPendingMessages() {
        // 1. 查询待发送消息
        List<LocalMessage> messages = messageMapper.selectByStatus(
            MessageStatus.SENDING, 100
        );
        
        for (LocalMessage message : messages) {
            try {
                // 2. 发送消息
                SendResult result = rocketMQTemplate.syncSend(
                    message.getTopic(), 
                    message.getBody()
                );
                
                if (result.getSendStatus() == SendStatus.SEND_OK) {
                    // 3. 更新状态为已发送
                    messageMapper.updateStatus(message.getMessageId(), MessageStatus.SENT);
                }
            } catch (Exception e) {
                // 4. 发送失败，增加重试次数
                messageMapper.incrementRetryCount(message.getMessageId());
                
                // 5. 超过最大重试次数，标记为失败
                if (message.getRetryCount() >= 5) {
                    messageMapper.updateStatus(message.getMessageId(), MessageStatus.FAILED);
                    // 告警通知人工介入
                    alertService.sendAlert("消息发送失败", message);
                }
            }
        }
    }
}
```

#### 优缺点

| 优点 | 缺点 |
| --- | --- |
| 实现简单 | 需要额外的消息表 |
| 不依赖特殊中间件 | 定时任务有延迟 |
| 最终一致性 | 需要处理幂等 |

* * *

### 2.5 事务消息（RocketMQ）

#### 原理

RocketMQ提供事务消息机制，保证本地事务和消息发送的原子性。

```sql
生产者                 RocketMQ           消费者
   │                      │                 │
   ├─1.发送半消息────────→│                 │
   │   (不可被消费)       │                 │
   │                      │                 │
   ├─2.执行本地事务       │                 │
   │   └─扣减库存         │                 │
   │                      │                 │
   ├─3.提交/回滚消息─────→│                 │
   │   └─Commit/Rollback  │                 │
   │                      │                 │
   │                      ├─4.投递消息─────→│
   │                      │                 ├─消费消息
   │                      │                 ├─创建订单
```

#### 完整代码示例

**事务消息生产者**：

```typescript
@Service
public class InventoryTransactionProducer {
    
    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    
    public void reduceStockAndNotify(Long skuId, Integer qty, String orderId) {
        // 构建消息
        StockReducedEvent event = new StockReducedEvent(skuId, qty, orderId);
        Message<StockReducedEvent> message = MessageBuilder.withPayload(event).build();
        
        // 发送事务消息
        rocketMQTemplate.sendMessageInTransaction(
            "stock-reduced-group",  // 事务组名
            "stock-reduced",        // topic
            message,                // 消息体
            null                    // 本地事务参数
        );
    }
}

// 事务监听器
@RocketMQTransactionListener(rocketMQTemplateBeanName = "rocketMQTemplate")
public class StockTransactionListener implements RocketMQLocalTransactionListener {
    
    @Autowired
    private InventoryMapper inventoryMapper;
    
    @Autowired
    private LocalTransactionLogMapper transactionLogMapper;
    
    /**
     * 执行本地事务
     */
    @Override
    public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        try {
            // 解析消息
            StockReducedEvent event = JSON.parseObject(
                new String((byte[]) msg.getPayload()),
                StockReducedEvent.class
            );
            
            // 检查是否已执行（幂等）
            if (transactionLogMapper.exists(event.getOrderId())) {
                return RocketMQLocalTransactionState.COMMIT;
            }
            
            // 执行本地事务：扣减库存
            inventoryMapper.reduceStock(event.getSkuId(), event.getQty());
            
            // 记录事务日志
            transactionLogMapper.insert(event.getOrderId());
            
            // 返回提交
            return RocketMQLocalTransactionState.COMMIT;
            
        } catch (Exception e) {
            log.error("本地事务执行失败", e);
            return RocketMQLocalTransactionState.ROLLBACK;
        }
    }
    
    /**
     * 事务回查（本地事务执行后未返回状态时调用）
     */
    @Override
    public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
        StockReducedEvent event = JSON.parseObject(
            new String((byte[]) msg.getPayload()),
            StockReducedEvent.class
        );
        
        // 检查本地事务是否执行成功
        boolean exists = transactionLogMapper.exists(event.getOrderId());
        
        return exists ? 
            RocketMQLocalTransactionState.COMMIT : 
            RocketMQLocalTransactionState.ROLLBACK;
    }
}
```

**消息消费者**：

```less
@Service
@RocketMQMessageListener(
    topic = "stock-reduced",
    consumerGroup = "order-consumer-group"
)
public class StockReducedConsumer implements RocketMQListener<StockReducedEvent> {
    
    @Autowired
    private OrderService orderService;
    
    @Override
    public void onMessage(StockReducedEvent event) {
        try {
            // 幂等检查
            if (orderService.existsByTransactionId(event.getOrderId())) {
                return;
            }
            
            // 创建订单
            orderService.createOrder(event);
            
        } catch (Exception e) {
            log.error("订单创建失败", e);
            throw new RuntimeException("消费失败，触发重试");
        }
    }
}
```

#### 优缺点

| 优点 | 缺点 |
| --- | --- |
| 最终一致性有保障 | 依赖RocketMQ |
| 无需额外消息表 | 实现相对复杂 |
| 自动事务回查 | 消费者需幂等 |

* * *

### 2.6 模式对比总结

| 模式 | 一致性 | 性能 | 复杂度 | 资源锁定 | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| 2PC/XA | 强一致 | 低 | 低 | 长 | 数据库层面、单体多库 |
| TCC | 最终一致 | 高 | 高 | 短 | 高并发、跨服务 |
| Saga | 最终一致 | 高 | 中 | 无 | 长流程、跨多服务 |
| 本地消息表 | 最终一致 | 中 | 低 | 无 | 异步场景、可靠性优先 |
| 事务消息 | 最终一致 | 高 | 中 | 无 | 异步场景、已有MQ |

* * *

## 三、主流中间件对比与选型

### 3.1 主流中间件一览

| 中间件 | 开源/商业 | 开发语言 | 核心模式 | 社区活跃度 | 企业案例 |
| --- | --- | --- | --- | --- | --- |
| **Seata** | 开源（Apache） | Java | AT/TCC/Saga/XA | ⭐⭐⭐⭐⭐ | 阿里、腾讯、京东 |
| **DTM** | 开源（BSD） | Go | TCC/Saga/2PC/XA | ⭐⭐⭐⭐ | 腾讯、华为 |
| **RocketMQ事务消息** | 开源（Apache） | Java | 事务消息 | ⭐⭐⭐⭐⭐ | 阿里、滴滴 |
| **ByteTCC** | 开源 | Java | TCC | ⭐⭐⭐ | 个人项目为主 |
| **Hmily** | 开源 | Java | TCC/Saga | ⭐⭐⭐ | 个人项目为主 |
| **Axon Framework** | 开源 | Java | Saga/CQRS | ⭐⭐⭐ | 欧美企业 |

* * *

### 3.2 Seata深入分析

#### 简介

Seata（Simple Extensible Autonomous Transaction Architecture）是阿里开源的分布式事务解决方案，提供AT、TCC、Saga、XA四种模式。

#### 核心概念

| 概念 | 说明 |
| --- | --- |
| **TC (Transaction Coordinator)** | 事务协调者，维护全局事务状态 |
| **TM (Transaction Manager)** | 事务管理器，开启/提交/回滚全局事务 |
| **RM (Resource Manager)** | 资源管理器，管理分支事务资源 |

#### 架构图

```scss
                    TC (Seata Server)
                    ├─全局事务状态管理
                    ├─分支事务注册
                    └─全局锁管理
                           ↑
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   TM (订单服务)       RM (库存服务)      RM (支付服务)
   ├─开启全局事务       ├─注册分支事务      ├─注册分支事务
   ├─提交/回滚         ├─上报状态          ├─上报状态
   └─@GlobalTransactional └─数据源代理      └─数据源代理
```

#### 四种模式对比

| 模式 | 原理 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| **AT** | 自动解析SQL，生成前后镜像 | 无侵入、开发快 | 性能一般、有全局锁 | 大多数场景 |
| **TCC** | Try-Confirm-Cancel | 性能高、灵活 | 代码侵入强 | 高并发、资源锁定短 |
| **Saga** | 长事务拆分+补偿 | 适合长流程 | 无隔离性 | 长流程业务 |
| **XA** | 数据库XA协议 | 强一致 | 性能差、锁资源 | 数据库层面 |

#### AT模式原理

**核心思想**：通过解析SQL，自动记录数据前后镜像，自动生成回滚SQL。

```sql
执行SQL: UPDATE inventory SET stock = stock - 10 WHERE sku_id = 123

前置镜像（Before Image）:
{
  "sku_id": 123,
  "stock": 100
}

后置镜像（After Image）:
{
  "sku_id": 123,
  "stock": 90
}

回滚SQL（自动生成）:
UPDATE inventory SET stock = 100 WHERE sku_id = 123
```

**代码示例**：

```typescript
@Service
public class OrderService {
    
    @GlobalTransactional(name = "create-order", rollbackFor = Exception.class)
    public void createOrder(OrderRequest request) {
        // 1. 创建订单
        orderMapper.insert(buildOrder(request));
        
        // 2. 扣减库存（远程调用）
        inventoryService.reduceStock(request.getSkuId(), request.getQty());
        
        // 3. 使用优惠券（远程调用）
        couponService.useCoupon(request.getUserId(), request.getCouponId());
        
        // 任意一步失败，自动回滚所有操作
    }
}

// 库存服务（无需特殊注解）
@Service
public class InventoryService {
    
    public void reduceStock(Long skuId, Integer qty) {
        // 普通SQL操作，Seata自动拦截并记录镜像
        inventoryMapper.reduceStock(skuId, qty);
    }
}
```

**AT模式全局锁**：

```less
事务A (购买商品X):
  ├─获取商品X的全局锁
  ├─执行UPDATE stock = stock - 10
  └─提交前等待全局锁释放

事务B (购买商品X):
  ├─尝试获取商品X的全局锁
  ├─等待...（全局锁被A持有）
  └─超时回滚
```

#### Seata Server部署

**配置文件（application.yml）** ：

```yaml
server:
  port: 7091

spring:
  application:
    name: seata-server

seata:
  config:
    type: nacos
    nacos:
      server-addr: 127.0.0.1:8848
      namespace: seata
      group: SEATA_GROUP
      
  registry:
    type: nacos
    nacos:
      server-addr: 127.0.0.1:8848
      namespace: seata
      group: SEATA_GROUP
      application: seata-server
      
  store:
    mode: db
    db:
      datasource: druid
      db-type: mysql
      driver-class-name: com.mysql.cj.jdbc.Driver
      url: jdbc:mysql://127.0.0.1:3306/seata
      user: root
      password: root
```

**数据库建表**：

```scss
-- 全局事务表
CREATE TABLE `global_table` (
  `xid` varchar(128) NOT NULL,
  `transaction_id` bigint DEFAULT NULL,
  `status` tinyint NOT NULL,
  `application_id` varchar(32) DEFAULT NULL,
  `transaction_service_group` varchar(32) DEFAULT NULL,
  `transaction_name` varchar(128) DEFAULT NULL,
  `timeout` int DEFAULT NULL,
  `begin_time` bigint DEFAULT NULL,
  `application_data` varchar(2000) DEFAULT NULL,
  `gmt_create` datetime DEFAULT NULL,
  `gmt_modified` datetime DEFAULT NULL,
  PRIMARY KEY (`xid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 分支事务表
CREATE TABLE `branch_table` (
  `branch_id` bigint NOT NULL,
  `xid` varchar(128) NOT NULL,
  `transaction_id` bigint DEFAULT NULL,
  `resource_group_id` varchar(32) DEFAULT NULL,
  `resource_id` varchar(256) DEFAULT NULL,
  `branch_type` varchar(8) DEFAULT NULL,
  `status` tinyint DEFAULT NULL,
  `client_id` varchar(64) DEFAULT NULL,
  `application_data` varchar(2000) DEFAULT NULL,
  `gmt_create` datetime DEFAULT NULL,
  `gmt_modified` datetime DEFAULT NULL,
  PRIMARY KEY (`branch_id`),
  KEY `idx_xid` (`xid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 全局锁表
CREATE TABLE `lock_table` (
  `row_key` varchar(128) NOT NULL,
  `xid` varchar(128) DEFAULT NULL,
  `transaction_id` bigint DEFAULT NULL,
  `branch_id` bigint NOT NULL,
  `resource_id` varchar(256) DEFAULT NULL,
  `table_name` varchar(32) DEFAULT NULL,
  `pk` varchar(36) DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '0',
  `gmt_create` datetime DEFAULT NULL,
  `gmt_modified` datetime DEFAULT NULL,
  PRIMARY KEY (`row_key`),
  KEY `idx_branch_id` (`branch_id`),
  KEY `idx_xid_and_branch_id` (`xid`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 客户端配置

**Maven依赖**：

```xml
<dependency>
    <groupId>io.seata</groupId>
    <artifactId>seata-spring-boot-starter</artifactId>
    <version>1.7.1</version>
</dependency>

<!-- 使用OpenFeign进行远程调用 -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>
```

**配置文件**：

```yaml
seata:
  enabled: true
  application-id: order-service
  tx-service-group: niushi_tx_group
  service:
    vgroup-mapping:
      niushi_tx_group: default
  registry:
    type: nacos
    nacos:
      server-addr: 127.0.0.1:8848
      namespace: seata
      group: SEATA_GROUP
      application: seata-server
  config:
    type: nacos
    nacos:
      server-addr: 127.0.0.1:8848
      namespace: seata
      group: SEATA_GROUP
      
# 数据源代理（AT模式必需）
spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://127.0.0.1:3306/order_db
    username: root
    password: root
```

**数据源代理配置类**：

```typescript
@Configuration
public class DataSourceProxyConfig {
    
    @Bean
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        return new DruidDataSource();
    }
    
    @Bean
    public DataSourceProxy dataSourceProxy(DataSource dataSource) {
        return new DataSourceProxy(dataSource);
    }
}
```

**undo_log表（AT模式必需）** ：

```sql
-- 每个业务库都需要
CREATE TABLE `undo_log` (
  `branch_id` bigint NOT NULL COMMENT 'branch transaction id',
  `xid` varchar(128) NOT NULL COMMENT 'global transaction id',
  `context` varchar(128) NOT NULL COMMENT 'undo_log context',
  `rollback_info` longblob NOT NULL COMMENT 'rollback info',
  `log_status` int NOT NULL COMMENT '0:normal status,1:defense status',
  `log_created` datetime(6) NOT NULL COMMENT 'create datetime',
  `log_modified` datetime(6) NOT NULL COMMENT 'modify datetime',
  UNIQUE KEY `ux_undo_log` (`xid`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AT transaction mode undo table';
```

* * *

### 3.3 DTM深入分析

#### 简介

DTM是一款Go语言开发的分布式事务管理器，支持HTTP/gRPC协议，跨语言兼容性好。

#### 核心特性

| 特性 | 说明 |
| --- | --- |
| **跨语言** | 支持Go/Java/Python/PHP/Node.js |
| **多模式** | 支持TCC/SAGA/2PC/XA/事务消息 |
| **易部署** | 单二进制文件，无复杂依赖 |
| **轻量级** | 性能高，资源占用少 |

#### 架构示例

**TCC模式**：

```go
// Go示例
func main() {
    // 1. 创建DTM客户端
    dtmClient := dtmcli.NewDtmClient("http://localhost:36789")
    
    // 2. 创建TCC事务
    gid := dtmcli.MustGenGid(dtmServer)
    err := dtmClient.TccGlobalTransaction(gid, func(tcc *dtmcli.Tcc) (*resty.Response, error) {
        // 3. 注册分支事务
        resp, err := tcc.CallBranch(
            &req,                              // 请求参数
            "http://inventory:8081/TryFreeze",  // Try URL
            "http://inventory:8081/ConfirmReduce", // Confirm URL
            "http://inventory:8081/CancelFreeze",  // Cancel URL
        )
        if err != nil {
            return nil, err
        }
        
        // 4. 注册订单分支
        resp, err = tcc.CallBranch(
            &req,
            "http://order:8082/TryCreate",
            "http://order:8082/ConfirmCreate",
            "http://order:8082/CancelCreate",
        )
        return resp, err
    })
}
```

**Saga模式**：

```css
// Saga示例
func main() {
    dtmClient := dtmcli.NewDtmClient("http://localhost:36789")
    
    gid := dtmcli.MustGenGid(dtmServer)
    
    saga := dtmcli.NewSaga(dtmServer, gid).
        Add("http://inventory:8081/reduce", "http://inventory:8081/restore", req).
        Add("http://order:8082/create", "http://order:8082/cancel", req).
        Add("http://payment:8083/pay", "http://payment:8083/refund", req)
    
    err := saga.Submit()
}
```

* * *

### 3.4 中间件选型决策矩阵

#### 决策树

```markdown
是否需要强一致性？
├─ 是 → 选择XA模式（Seata XA）
│
└─ 否（可接受最终一致）
    │
    ├─ 是否跨语言？
    │   ├─ 是 → DTM（支持多语言）
    │   └─ 否 → 继续
    │
    ├─ 是否需要无代码侵入？
    │   ├─ 是 → Seata AT模式
    │   └─ 否 → 继续
    │
    ├─ 是否已有消息队列？
    │   ├─ 是，RocketMQ → 事务消息
    │   ├─ 是，其他MQ → 本地消息表
    │   └─ 否 → 继续
    │
    ├─ 是否需要高性能？
    │   ├─ 是 → TCC（Seata/DTM）
    │   └─ 否 → Saga
    │
    └─ 是否是长流程业务？
        ├─ 是 → Saga
        └─ 否 → TCC
```

#### 场景匹配表

| 业务场景 | 推荐方案 | 理由 |
| --- | --- | --- |
| 订单+库存+优惠券（同步） | Seata AT | 无侵入、开发快 |
| 订单+库存+优惠券（高并发） | Seata TCC | 性能高、资源锁定短 |
| 订单+库存+支付+物流（长流程） | Seata Saga | 适合长流程 |
| 库存扣减+订单创建（异步） | RocketMQ事务消息 | 解耦、异步 |
| 跨语言微服务（Go+Java） | DTM | 跨语言支持 |
| 银行转账（强一致） | Seata XA | 强一致性 |

#### 成本分析

| 维度 | Seata AT | Seata TCC | Seata Saga | DTM | 事务消息 |
| --- | --- | --- | --- | --- | --- |
| **开发成本** | 低 | 高 | 中 | 中 | 中 |
| **运维成本** | 中（需部署Server） | 中 | 中 | 低（单二进制） | 低（已有MQ） |
| **学习成本** | 低 | 高 | 中 | 中 | 中 |
| **改造成本** | 低（加注解） | 高（写三个接口） | 中 | 中 | 中 |
| **性能** | 中 | 高 | 高 | 高 | 高 |

* * *

## 四、实战接入案例

### 4.1 项目背景

**业务场景**：订单系统微服务化改造

**涉及服务**：

-   订单服务（order-service）
-   库存服务（inventory-service）
-   优惠券服务（coupon-service）
-   积分服务（point-service）

**技术栈**：

-   Spring Boot 2.7.x
-   Spring Cloud 2021.x
-   MySQL 8.0
-   RocketMQ 5.x
-   Seata 1.7.1

### 4.2 选型决策

**决策过程**：

```markdown
1. 是否需要强一致？ 
   → 否，可接受最终一致

2. 是否跨语言？
   → 否，全部Java栈

3. 是否需要无代码侵入？
   → 优先考虑，但可接受一定改造

4. 是否已有MQ？
   → 是，RocketMQ

5. 性能要求？
   → 大促QPS 8000+，要求高性能

6. 流程复杂度？
   → 订单+库存+优惠券+积分，流程较长
```

**最终选择**：

| 场景 | 方案 |
| --- | --- |
| 同步场景（订单+库存+优惠券） | Seata AT模式（开发快） |
| 异步场景（积分发放） | RocketMQ事务消息 |

### 4.3 Seata AT模式接入

#### Step 1: 部署Seata Server

```ini
# Docker部署
docker run -d --name seata-server \
  -p 8091:8091 \
  -p 7091:7091 \
  -e SEATA_IP=192.168.1.100 \
  seataio/seata-server:1.7.1
```

#### Step 2: 添加依赖

```xml
<!-- 所有参与事务的服务都需添加 -->
<dependency>
    <groupId>io.seata</groupId>
    <artifactId>seata-spring-boot-starter</artifactId>
    <version>1.7.1</version>
</dependency>
```

#### Step 3: 配置文件

```yaml
# application.yml（所有服务）
seata:
  enabled: true
  application-id: ${spring.application.name}
  tx-service-group: niushi_tx_group
  service:
    vgroup-mapping:
      niushi_tx_group: default
  registry:
    type: file
    file:
      name: file.conf
  config:
    type: file
    file:
      name: file.conf
```

#### Step 4: 创建undo_log表

```r
-- 每个业务库执行
CREATE TABLE `undo_log` (
  `branch_id` bigint NOT NULL,
  `xid` varchar(128) NOT NULL,
  `context` varchar(128) NOT NULL,
  `rollback_info` longblob NOT NULL,
  `log_status` int NOT NULL,
  `log_created` datetime(6) NOT NULL,
  `log_modified` datetime(6) NOT NULL,
  UNIQUE KEY `ux_undo_log` (`xid`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### Step 5: 业务代码改造

**订单服务**：

```scss
@Service
public class OrderServiceImpl implements OrderService {
    
    @Autowired
    private OrderMapper orderMapper;
    
    @Autowired
    private InventoryFeignClient inventoryClient;
    
    @Autowired
    private CouponFeignClient couponClient;
    
    @Override
    @GlobalTransactional(name = "create-order", rollbackFor = Exception.class)
    public OrderDTO createOrder(OrderRequest request) {
        log.info("开始创建订单, XID: {}", RootContext.getXid());
        
        // 1. 创建订单（本地事务）
        Order order = buildOrder(request);
        orderMapper.insert(order);
        
        // 2. 扣减库存（远程调用）
        InventoryReduceDTO inventoryReq = new InventoryReduceDTO();
        inventoryReq.setSkuId(request.getSkuId());
        inventoryReq.setQty(request.getQty());
        inventoryReq.setOrderId(order.getId());
        
        Result<Void> inventoryResult = inventoryClient.reduceStock(inventoryReq);
        if (!inventoryResult.isSuccess()) {
            throw new BusinessException("库存扣减失败: " + inventoryResult.getMessage());
        }
        
        // 3. 使用优惠券（远程调用）
        if (request.getCouponId() != null) {
            CouponUseDTO couponReq = new CouponUseDTO();
            couponReq.setCouponId(request.getCouponId());
            couponReq.setOrderId(order.getId());
            
            Result<Void> couponResult = couponClient.useCoupon(couponReq);
            if (!couponResult.isSuccess()) {
                throw new BusinessException("优惠券使用失败: " + couponResult.getMessage());
            }
        }
        
        // 4. 异步发放积分（通过RocketMQ）
        PointEvent pointEvent = new PointEvent();
        pointEvent.setUserId(request.getUserId());
        pointEvent.setPoints(calculatePoints(order));
        pointEvent.setOrderId(order.getId());
        rocketMQTemplate.asyncSend("point-award", pointEvent, new SendCallback() {
            @Override
            public void onSuccess(SendResult sendResult) {
                log.info("积分发放消息发送成功");
            }
            
            @Override
            public void onException(Throwable e) {
                log.error("积分发放消息发送失败", e);
            }
        });
        
        log.info("订单创建成功, orderId: {}", order.getId());
        return convertToDTO(order);
    }
}
```

**库存服务**：

```less
@RestController
@RequestMapping("/inventory")
public class InventoryController {
    
    @Autowired
    private InventoryMapper inventoryMapper;
    
    @PostMapping("/reduce")
    public Result<Void> reduceStock(@RequestBody InventoryReduceDTO req) {
        log.info("扣减库存, XID: {}", RootContext.getXid());
        
        // 检查库存
        Inventory inventory = inventoryMapper.selectBySkuId(req.getSkuId());
        if (inventory.getStock() < req.getQty()) {
            return Result.fail("库存不足");
        }
        
        // 扣减库存（Seata自动拦截）
        inventoryMapper.reduceStock(req.getSkuId(), req.getQty());
        
        return Result.success();
    }
}
```

### 4.4 RocketMQ事务消息接入

**积分服务（异步场景）** ：

```csharp
@Service
public class PointService {
    
    @Autowired
    private PointMapper pointMapper;
    
    @Autowired
    private TransactionLogMapper transactionLogMapper;
    
    /**
     * 发放积分（幂等）
     */
    public void awardPoints(PointEvent event) {
        // 幂等检查
        if (transactionLogMapper.exists(event.getOrderId())) {
            log.info("积分已发放, orderId: {}", event.getOrderId());
            return;
        }
        
        // 发放积分
        PointRecord record = new PointRecord();
        record.setUserId(event.getUserId());
        record.setPoints(event.getPoints());
        record.setSource("ORDER");
        record.setSourceId(event.getOrderId());
        pointMapper.insert(record);
        
        // 更新用户总积分
        pointMapper.updateUserTotalPoints(event.getUserId(), event.getPoints());
        
        // 记录事务日志
        transactionLogMapper.insert(event.getOrderId());
        
        log.info("积分发放成功, userId: {}, points: {}", event.getUserId(), event.getPoints());
    }
}

// 消费者
@Service
@RocketMQMessageListener(
    topic = "point-award",
    consumerGroup = "point-consumer-group"
)
public class PointAwardConsumer implements RocketMQListener<PointEvent> {
    
    @Autowired
    private PointService pointService;
    
    @Override
    public void onMessage(PointEvent event) {
        try {
            pointService.awardPoints(event);
        } catch (Exception e) {
            log.error("积分发放失败", e);
            throw new RuntimeException("消费失败，触发重试");
        }
    }
}
```

### 4.5 监控与运维

#### Seata监控指标

```ini
# Prometheus指标
seata_transaction_total{status="committed"} 15234
seata_transaction_total{status="rollbacked"} 128
seata_transaction_duration_seconds{quantile="0.99"} 2.3
seata_active_transaction_count 45
seata_global_lock_conflict_total 12
```

#### 告警规则

```yaml
groups:
  - name: seata-alerts
    rules:
      - alert: SeataTransactionRollbackHigh
        expr: rate(seata_transaction_total{status="rollbacked"}[5m]) > 10
        for: 2m
        annotations:
          summary: "Seata事务回滚率过高"
          
      - alert: SeataServerDown
        expr: up{job="seata-server"} == 0
        for: 1m
        annotations:
          summary: "Seata Server不可用"
          
      - alert: SeataActiveTransactionHigh
        expr: seata_active_transaction_count > 1000
        for: 5m
        annotations:
          summary: "Seata活跃事务过多"
```

* * *

## 五、踩坑经验与最佳实践

### 5.1 常见问题与解决方案

#### 问题1: 全局锁冲突

**现象**：

```ini
io.seata.rm.datasource.exec.LockConflictException: 
  Global lock conflict, xid = 192.168.1.100:8091:123456
```

**原因**：

-   多个全局事务同时操作同一行数据
-   前一个事务未提交，后一个事务等待超时

**解决方案**：

```yaml
# 增加全局锁等待时间
seata:
  client:
    rm:
      lock:
        retry-interval: 10    # 获取锁重试间隔(ms)
        retry-times: 30       # 获取锁重试次数
```

```typescript
// 业务层面：缩短事务范围
@GlobalTransactional
public void createOrder() {
    // ❌ 不要在事务内做耗时操作
    // Thread.sleep(5000); 
    
    // ✅ 只包含必要的事务操作
    orderMapper.insert(order);
    inventoryClient.reduceStock(req);
}
```

#### 问题2: 事务超时

**现象**：

```ini
io.seata.tm.api.GlobalTransactionException: 
  Transaction timeout, xid = 192.168.1.100:8091:123456
```

**解决方案**：

```java
// 设置合理的超时时间
@GlobalTransactional(timeoutMills = 30000) // 30秒
public void createOrder() { ... }
```

#### 问题3: 事务传播问题

**现象**：

```typescript
@Service
public class OrderService {
    
    @GlobalTransactional
    public void methodA() {
        methodB(); // 内部调用，事务不生效
    }
    
    @GlobalTransactional(propagation = Propagation.REQUIRES_NEW)
    public void methodB() {
        // 期望开启新事务，但实际不会
    }
}
```

**解决方案**：

```typescript
// 方案1: 注入自己，通过代理调用
@Service
public class OrderService {
    
    @Autowired
    private OrderService self; // 注入自己
    
    @GlobalTransactional
    public void methodA() {
        self.methodB(); // 通过代理调用
    }
    
    @GlobalTransactional(propagation = Propagation.REQUIRES_NEW)
    public void methodB() { ... }
}

// 方案2: 使用AopContext
@GlobalTransactional
public void methodA() {
    ((OrderService) AopContext.currentProxy()).methodB();
}
```

#### 问题4: undolog清理

**现象**：

undo_log表数据量过大，影响性能

**解决方案**：

```typescript
// Seata默认在事务提交后异步删除undo_log
// 如需手动清理：

@Scheduled(cron = "0 0 3 * * ?") // 每天凌晨3点
public void cleanUndoLog() {
    // 删除7天前的undo_log
    undoLogMapper.deleteByCreateTime(
        LocalDateTime.now().minusDays(7)
    );
}
```

### 5.2 最佳实践

#### 1\. 事务范围最小化

```scss
// ❌ 错误：事务范围过大
@GlobalTransactional
public void createOrder(OrderRequest request) {
    // 参数校验（不需要事务）
    validateRequest(request);
    
    // 调用外部接口（不需要事务）
    UserInfo user = userService.getUser(request.getUserId());
    
    // 业务操作（需要事务）
    orderMapper.insert(order);
    inventoryClient.reduceStock(req);
    
    // 发送通知（不需要事务）
    notificationService.sendSMS(user.getPhone(), "订单创建成功");
}

// ✅ 正确：事务范围最小化
public void createOrder(OrderRequest request) {
    // 非事务操作
    validateRequest(request);
    UserInfo user = userService.getUser(request.getUserId());
    
    // 事务操作
    doCreateOrder(request);
    
    // 非事务操作
    notificationService.sendSMS(user.getPhone(), "订单创建成功");
}

@GlobalTransactional
private void doCreateOrder(OrderRequest request) {
    orderMapper.insert(order);
    inventoryClient.reduceStock(req);
}
```

#### 2\. 幂等性设计

```less
// 每个接口都要考虑幂等
@PostMapping("/reduce")
public Result<Void> reduceStock(@RequestBody InventoryReduceDTO req) {
    // 幂等检查：通过XID + 业务ID
    String lockKey = req.getOrderId() + ":" + req.getSkuId();
    Boolean acquired = redisTemplate.opsForValue().setIfAbsent(
        "lock:" + lockKey, "1", 10, TimeUnit.MINUTES
    );
    
    if (!acquired) {
        // 可能是重复请求，检查是否已处理
        if (inventoryMapper.checkReduced(req.getOrderId(), req.getSkuId())) {
            return Result.success(); // 已处理，返回成功
        }
        return Result.fail("请求处理中");
    }
    
    // 业务处理...
}
```

#### 3\. 降级与兜底

```scss
@Service
public class OrderService {
    
    @GlobalTransactional
    public void createOrder(OrderRequest request) {
        try {
            // 正常流程
            orderMapper.insert(order);
            inventoryClient.reduceStock(req);
        } catch (Exception e) {
            // 降级：记录日志，人工处理
            log.error("分布式事务失败", e);
            compensationService.recordFailure(order.getId(), e.getMessage());
            throw e;
        }
    }
}

// 补偿服务
@Service
public class CompensationService {
    
    public void recordFailure(Long orderId, String reason) {
        CompensationRecord record = new CompensationRecord();
        record.setOrderId(orderId);
        record.setReason(reason);
        record.setStatus(CompensationStatus.PENDING);
        compensationMapper.insert(record);
        
        // 发送告警
        alertService.sendAlert("分布式事务失败", record);
    }
    
    @Scheduled(fixedDelay = 60000)
    public void retryCompensation() {
        List<CompensationRecord> records = compensationMapper.selectPending();
        for (CompensationRecord record : records) {
            try {
                // 手动补偿
                compensate(record);
                compensationMapper.updateStatus(record.getId(), CompensationStatus.SUCCESS);
            } catch (Exception e) {
                compensationMapper.incrementRetryCount(record.getId());
            }
        }
    }
}
```

* * *

## 六、总结与建议

### 6.1 选型建议速查

| 场景特征 | 推荐方案 |
| --- | --- |
| Java栈 + 快速接入 + 中等并发 | Seata AT |
| Java栈 + 高并发 + 可接受改造 | Seata TCC |
| Java栈 + 长流程业务 | Seata Saga |
| 跨语言微服务 | DTM |
| 已有RocketMQ + 异步场景 | RocketMQ事务消息 |
| 强一致性要求 | Seata XA |
| 小团队 + 简单场景 | 本地消息表 |

### 6.2 接入检查清单

```ini
## Seata AT模式接入清单
- [ ] Seata Server部署完成
- [ ] 所有服务添加seata依赖
- [ ] 所有业务库创建undo_log表
- [ ] 配置注册中心和配置中心
- [ ] 业务方法添加@GlobalTransactional注解
- [ ] 接口幂等性检查
- [ ] 监控告警配置完成
- [ ] 压测验证通过
```

### 6.3 学习路径建议

```objectivec
入门（1周）
├─ 理解CAP、BASE理论
├─ 掌握2PC、TCC、Saga原理
└─ 学习Seata AT模式

进阶（2周）
├─ Seata TCC/Saga实践
├─ RocketMQ事务消息
├─ 幂等性设计
└─ 监控与运维

精通（持续）
├─ 性能调优
├─ 源码阅读
├─ 复杂场景架构设计
└─ 故障诊断与处理
```

* * *

## 七、参考资料

**官方文档**:

-   [Seata官方文档](https://link.juejin.cn?target=https%3A%2F%2Fseata.io%2Fzh-cn%2Fdocs%2Foverview%2Fwhat-is-seata.html "https://seata.io/zh-cn/docs/overview/what-is-seata.html")
-   [DTM官方文档](https://link.juejin.cn?target=https%3A%2F%2Fdtm.pub%2F "https://dtm.pub/")
-   [RocketMQ事务消息](https://link.juejin.cn?target=https%3A%2F%2Frocketmq.apache.org%2Fzh%2Fdocs%2FfeatureBehavior%2F04transactionmessage%2F "https://rocketmq.apache.org/zh/docs/featureBehavior/04transactionmessage/")

**推荐书籍**:

-   《分布式系统原理与范型》
-   《微服务架构设计模式》
-   《数据密集型应用系统设计》

**开源项目**:

-   [Seata Samples](https://link.juejin.cn?target=https%3A%2F%2Fgithub.com%2Fseata%2Fseata-samples "https://github.com/seata/seata-samples")
-   [DTM Examples](https://link.juejin.cn?target=https%3A%2F%2Fgithub.com%2Fdtm-labs%2Fdtm-examples "https://github.com/dtm-labs/dtm-examples")
