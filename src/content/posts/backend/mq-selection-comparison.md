---
title: "消息队列选型：Kafka vs RabbitMQ vs RocketMQ"
pubDate: 2026-03-17
category: backend
tags: []
summary: "前言 消息队列是后端架构的核心组件，但很多人只会用，不知道怎么选。 Kafka、RabbitMQ、RocketMQ，到底该用哪个？这篇文章从架构、性能、场景三个维度帮你做决策。 一、消息队列核心作用 "
draft: false
juejin:
  id: "7617769259800018986"
  url: https://juejin.cn/post/7617769259800018986
  views: 258
  likes: 0

---
## 前言

消息队列是后端架构的核心组件，但很多人只会用，不知道怎么选。

Kafka、RabbitMQ、RocketMQ，到底该用哪个？这篇文章从**架构、性能、场景**三个维度帮你做决策。

* * *

## 一、消息队列核心作用

### 1.1 解耦

```markdown
没有 MQ：
订单服务 ──→ 库存服务
        ──→ 积分服务
        ──→ 通知服务
        （订单服务依赖所有服务）

有 MQ：
订单服务 ──→ MQ ──→ 库存服务
               ├──→ 积分服务
               └──→ 通知服务
        （订单服务只管发消息，不关心谁消费）
```

### 1.2 异步

```markdown
同步调用：
用户下单 → 扣库存（100ms）→ 加积分（50ms）→ 发通知（100ms）
总耗时：250ms

异步调用：
用户下单 → MQ ← 扣库存（异步）
             ← 加积分（异步）
             ← 发通知（异步）
总耗时：50ms（只发消息）
```

### 1.3 削峰

```
没有 MQ：
高并发请求 ──→ 数据库（被打爆）

有 MQ：
高并发请求 ──→ MQ ──→ 数据库（按消费速率处理）
```

* * *

## 二、三大 MQ 对比

### 2.1 架构对比

| 特性 | RabbitMQ | Kafka | RocketMQ |
| --- | --- | --- | --- |
| **开发语言** | Erlang | Scala/Java | Java |
| **协议支持** | AMQP | 自定义协议 | 自定义协议 |
| **架构** | Exchange + Queue | Topic + Partition | Topic + Queue |
| **存储** | 内存/磁盘 | 磁盘顺序写 | 磁盘 |
| **吞吐量** | 中等（万级/秒） | 极高（百万级/秒） | 高（十万级/秒） |

### 2.2 功能对比

| 功能 | RabbitMQ | Kafka | RocketMQ |
| --- | --- | --- | --- |
| 延迟队列 | ✅ 原生支持 | ❌ 不支持 | ✅ 支持 |
| 顺序消息 | ❌ 单队列支持 | ✅ Partition 支持 | ✅ 支持 |
| 消息回溯 | ❌ 不支持 | ✅ 按时间回溯 | ✅ 支持 |
| 事务消息 | ❌ 不支持 | ❌ 不支持 | ✅ 支持 |
| 死信队列 | ✅ 支持 | ❌ 不支持 | ✅ 支持 |
| 消息过滤 | ❌ 不支持 | ❌ 不支持 | ✅ Tag 过滤 |

### 2.3 可靠性对比

| 场景 | RabbitMQ | Kafka | RocketMQ |
| --- | --- | --- | --- |
| 消息丢失 | 极少丢失 | 配置得当不丢 | 不丢失 |
| 高可用 | 镜像队列 | 副本机制 | 主从复制 |
| 故障恢复 | 自动切换 | Leader 选举 | 自动切换 |

* * *

## 三、RabbitMQ

### 3.1 核心概念

```diff
Producer → Exchange → Queue → Consumer

Exchange 类型：
- Direct：路由键精确匹配
- Topic：路由键模式匹配
- Fanout：广播到所有队列
- Headers：按消息头匹配
```

### 3.2 适用场景

✅ 业务复杂，需要灵活路由 ✅ 消息可靠性要求高 ✅ 中小规模，吞吐量万级/秒 ✅ 需要延迟队列、死信队列

### 3.3 Spring Boot 集成

```typescript
@Configuration
public class RabbitConfig {
    
    @Bean
    public Queue orderQueue() {
        return new Queue("order.queue", true);
    }
    
    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange("order.exchange");
    }
    
    @Bean
    public Binding binding() {
        return BindingBuilder.bind(orderQueue())
            .to(orderExchange())
            .with("order.created");
    }
}

// 生产者
@Service
public class OrderProducer {
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void send(Order order) {
        rabbitTemplate.convertAndSend(
            "order.exchange",
            "order.created",
            order
        );
    }
}

// 消费者
@Component
public class OrderConsumer {
    
    @RabbitListener(queues = "order.queue")
    public void handle(Order order) {
        // 处理订单
    }
}
```

* * *

## 四、Kafka

### 4.1 核心概念

```sql
Producer → Topic → [Partition 0]
                 → [Partition 1]
                 → [Partition 2] → Consumer Group

特点：
- 顺序写磁盘，性能极高
- Partition 分布式存储
- Consumer Group 并行消费
```

### 4.2 适用场景

✅ 大数据场景，吞吐量百万级/秒 ✅ 日志收集、流处理 ✅ 消息回溯、数据重放 ✅ 不要求实时消费

### 4.3 Spring Boot 集成

```typescript
// 生产者
@Service
public class OrderProducer {
    
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;
    
    public void send(Order order) {
        kafkaTemplate.send("order-topic", JSON.toJSONString(order));
    }
}

// 消费者
@Component
public class OrderConsumer {
    
    @KafkaListener(topics = "order-topic", groupId = "order-group")
    public void handle(ConsumerRecord<String, String> record) {
        Order order = JSON.parseObject(record.value(), Order.class);
        // 处理订单
    }
}
```

### 4.4 Kafka 性能优化

```yaml
# 生产者配置
spring:
  kafka:
    producer:
      batch-size: 16384        # 批量发送大小
      buffer-memory: 33554432  # 缓冲区大小
      acks: all                # 确认机制
      compression-type: lz4    # 压缩算法

# 消费者配置
    consumer:
      max-poll-records: 500    # 单次拉取最大数量
      auto-offset-reset: earliest
```

* * *

## 五、RocketMQ

### 5.1 核心概念

```markdown
Producer → NameServer → Broker → Consumer
              ↓
         Topic + Queue

特点：
- 阿里开源，金融级可靠性
- 支持事务消息、延迟消息
- 消息过滤（Tag）
```

### 5.2 适用场景

✅ 金融场景，可靠性要求极高 ✅ 需要事务消息 ✅ 需要延迟消息 ✅ 消息过滤需求

### 5.3 Spring Boot 集成

```typescript
// 生产者
@Service
public class OrderProducer {
    
    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    
    public void send(Order order) {
        rocketMQTemplate.convertAndSend("order-topic:order-tag", order);
    }
    
    // 发送延迟消息
    public void sendDelay(Order order, int delayLevel) {
        Message<Order> message = MessageBuilder.withPayload(order).build();
        rocketMQTemplate.syncSend("order-topic", message, 3000, delayLevel);
        // delayLevel: 1s 5s 10s 30s 1m 2m 3m 4m 5m 6m 7m 8m 9m 10m 20m 30m 1h 2h
    }
}

// 消费者
@Component
@RocketMQMessageListener(
    topic = "order-topic",
    consumerGroup = "order-group",
    selectorExpression = "order-tag"
)
public class OrderConsumer implements RocketMQListener<Order> {
    
    @Override
    public void onMessage(Order order) {
        // 处理订单
    }
}
```

* * *

## 六、选型决策表

| 需求场景 | 推荐方案 |
| --- | --- |
| 业务系统，可靠性优先 | RabbitMQ |
| 日志收集，大数据 | Kafka |
| 金融场景，事务消息 | RocketMQ |
| 高吞吐，实时性要求不高 | Kafka |
| 中小规模，运维简单 | RabbitMQ |
| 阿里生态，云原生 | RocketMQ |

* * *

## 七、常见问题

### ❌ 问题 1：消息丢失怎么办？

```scss
// RabbitMQ：开启消息确认
rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
    if (!ack) {
        // 重发或记录日志
    }
});

// Kafka：设置 acks=all
acks=all

// RocketMQ：同步发送 + 事务消息
rocketMQTemplate.sendMessageInTransaction()
```

### ❌ 问题 2：消息重复消费怎么办？

```scss
// 幂等处理
public void handle(Order order) {
    // 检查是否已处理
    if (redisTemplate.opsForValue().setIfAbsent(
        "order:processed:" + order.getId(), 
        "1", 
        1, TimeUnit.DAYS
    )) {
        // 处理订单
        processOrder(order);
    }
}
```

### ❌ 问题 3：消息堆积怎么办？

1.  **增加消费者实例**
2.  **增加 Partition 数量**
3.  **批量消费**

* * *

## 总结

| MQ | 优势 | 劣势 | 推荐场景 |
| --- | --- | --- | --- |
| **RabbitMQ** | 功能丰富、可靠性高 | 吞吐量一般 | 业务系统 |
| **Kafka** | 吞吐量极高、可回溯 | 实时性一般 | 大数据 |
| **RocketMQ** | 事务消息、可靠性高 | 社区较小 | 金融场景 |

**记住**：没有最好的 MQ，只有最合适的 MQ。

* * *

> 💡 **互动**：你们项目用的是哪个 MQ？遇到过什么问题？评论区聊聊！
