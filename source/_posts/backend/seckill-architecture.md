---
title: "高并发系统设计：秒杀架构从原理到实现"
date: 2026-03-20
updated: 2026-03-20
categories:
  - 后端进阶
  - 高并发库存与缓存
tags: []
description: "一、秒杀系统的核心挑战 1.1 典型场景特征 瞬时流量：从 0 到 10 万+ QPS 只需几秒 库存有限：商品数量有限，卖完即止 数据一致：不能超卖、不能少卖 用户体验：不能卡顿、不能崩溃 1.2 "
juejin:
  id: "7618852263628931135"
  url: https://juejin.cn/post/7618852263628931135
  views: 243
  likes: 0
---

## 一、秒杀系统的核心挑战

### 1.1 典型场景特征

-   **瞬时流量**：从 0 到 10 万+ QPS 只需几秒
-   **库存有限**：商品数量有限，卖完即止
-   **数据一致**：不能超卖、不能少卖
-   **用户体验**：不能卡顿、不能崩溃

### 1.2 技术难点

| 难点 | 描述 | 解决思路 |
| --- | --- | --- |
| 高并发 | 瞬时流量巨大 | 限流、削峰、缓存 |
| 超卖问题 | 库存变为负数 | 分布式锁、数据库乐观锁 |
| 热点问题 | 单商品访问量极高 | 缓存预热、热点隔离 |
| 一致性 | 缓存与数据库不一致 | 延迟双删、消息队列 |
| 可用性 | 单点故障 | 限流降级、熔断 |

* * *

## 二、架构设计原则

### 2.1 总体架构

```markdown
用户 → CDN → 负载均衡 → 网关 → 应用层 → 缓存层 → 数据库
                ↓
           消息队列（削峰）
```

**核心思路**：层层过滤，尽早拦截无效请求

### 2.2 设计原则

1.  **动静分离**：静态资源 CDN 加速
2.  **请求削峰**：消息队列异步处理
3.  **缓存预热**：提前加载热点数据
4.  **限流降级**：保护系统不被压垮
5.  **热点隔离**：独立部署秒杀服务

* * *

## 三、核心技术实现

### 3.1 限流：守住第一道防线

#### 前端限流

```ini
// 点击后禁用按钮 5 秒
function seckill(productId) {
  const btn = document.querySelector('#seckill-btn');
  btn.disabled = true;
  btn.textContent = '抢购中...';
  
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = '立即抢购';
  }, 5000);
  
  // 发送请求
  sendRequest(productId);
}

// 验证码/答题，防止脚本
function showCaptcha() {
  // 显示图形验证码
}
```

#### 网关限流

```kotlin
// Nginx 限流
// limit_req_zone $binary_remote_addr zone=seckill:10m rate=10r/s;
// location /seckill {
//     limit_req zone=seckill burst=20 nodelay;
// }

// Spring Cloud Gateway + Sentinel
@Configuration
public class GatewayConfig {
    @Bean
    public Customizer<GatewayFilterSpec> seckillFilter() {
        return filter -> filter
            .requestRateLimiter(config -> config
                .setRateLimiter(seckillRateLimiter())
                .setKeyResolver(ipKeyResolver()));
    }
}
```

#### 应用层限流

```kotlin
// Guava RateLimiter
private RateLimiter rateLimiter = RateLimiter.create(1000); // 1000 QPS

public Result seckill(Long productId, Long userId) {
    if (!rateLimiter.tryAcquire()) {
        return Result.fail("系统繁忙，请稍后再试");
    }
    // 继续处理...
}

// Sentinel 热点参数限流
@SentinelResource(value = "seckill", blockHandler = "handleBlock")
public Result seckill(@RequestParam Long productId) {
    // 业务逻辑
}

// 限流回调
public Result handleBlock(Long productId, BlockException ex) {
    return Result.fail("抢购人数过多，请稍后再试");
}
```

### 3.2 缓存：减轻数据库压力

#### 多级缓存架构

```markdown
本地缓存（Caffeine）→ 分布式缓存（Redis）→ 数据库
      ↑                    ↑
   无网络开销          多实例共享
```

#### 缓存预热

```less
// 秒杀开始前，预热缓存
@Scheduled(cron = "0 0 0 * * ?")  // 每天凌晨
public void preloadSeckillCache() {
    List<SeckillProduct> products = getTodaySeckillProducts();
    for (SeckillProduct product : products) {
        // 缓存商品信息
        redisTemplate.opsForValue().set(
            "seckill:product:" + product.getId(),
            JSON.toJSONString(product),
            24, TimeUnit.HOURS
        );
        // 缓存库存（使用 Lua 脚本保证原子性）
        redisTemplate.opsForValue().set(
            "seckill:stock:" + product.getId(),
            String.valueOf(product.getStock()),
            24, TimeUnit.HOURS
        );
    }
}
```

#### 本地缓存

```kotlin
@Configuration
public class CacheConfig {
    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        manager.setCaffeine(Caffeine.newBuilder()
            .initialCapacity(100)
            .maximumSize(1000)
            .expireAfterWrite(5, TimeUnit.MINUTES));
        return manager;
    }
}

// 使用
@Cacheable(value = "seckill:product", key = "#productId")
public SeckillProduct getProduct(Long productId) {
    return productMapper.selectById(productId);
}
```

#### 缓存穿透防护

```kotlin
// 布隆过滤器
@Component
public class SeckillBloomFilter {
    private BloomFilter<Long> bloomFilter;
    
    @PostConstruct
    public void init() {
        bloomFilter = BloomFilter.create(
            Funnels.longFunnel(),
            1000000,  // 预计元素数量
            0.01      // 误判率
        );
        // 预加载商品 ID
        List<Long> productIds = productMapper.selectAllIds();
        productIds.forEach(bloomFilter::put);
    }
    
    public boolean mightContain(Long productId) {
        return bloomFilter.mightContain(productId);
    }
}

// 使用
public Result seckill(Long productId, Long userId) {
    if (!bloomFilter.mightContain(productId)) {
        return Result.fail("商品不存在");
    }
    // 继续处理...
}
```

### 3.3 库存扣减：防止超卖

#### 方案一：Redis + Lua 脚本（推荐）

```lua
-- seckill.lua
local productKey = KEYS[1]
local stockKey = KEYS[2]
local userId = ARGV[1]
local quantity = tonumber(ARGV[2])

-- 检查库存
local stock = tonumber(redis.call('GET', stockKey))
if not stock or stock < quantity then
    return 0  -- 库存不足
end

-- 检查是否已购买（防重复购买）
local boughtKey = productKey .. ':bought:' .. userId
if redis.call('EXISTS', boughtKey) == 1 then
    return -1  -- 已购买
end

-- 扣减库存
redis.call('DECRBY', stockKey, quantity)
-- 标记已购买
redis.call('SET', boughtKey, '1')
redis.call('EXPIRE', boughtKey, 86400)  -- 24小时过期

return 1  -- 成功
```

```vbnet
// Java 调用
public boolean deductStock(Long productId, Long userId, Integer quantity) {
    String script = IOUtils.toString(
        getClass().getResourceAsStream("/lua/seckill.lua"), 
        StandardCharsets.UTF_8
    );
    
    Long result = redisTemplate.execute(
        new DefaultRedisScript<>(script, Long.class),
        Arrays.asList(
            "seckill:product:" + productId,
            "seckill:stock:" + productId
        ),
        userId.toString(),
        quantity.toString()
    );
    
    return result != null && result == 1;
}
```

#### 方案二：数据库乐观锁

```ini
-- 扣减库存（带版本号）
UPDATE seckill_product 
SET stock = stock - 1, version = version + 1
WHERE id = ? AND stock > 0 AND version = ?
```

```sql
public boolean deductStock(Long productId, Integer version) {
    int rows = productMapper.deductStock(productId, version);
    return rows > 0;
}
```

#### 方案三：分布式锁 + Redis

```csharp
public boolean deductStock(Long productId, Long userId) {
    String lockKey = "seckill:lock:" + productId;
    RLock lock = redissonClient.getLock(lockKey);
    
    try {
        // 尝试获取锁（等待时间 0，锁自动释放时间 5 秒）
        if (lock.tryLock(0, 5, TimeUnit.SECONDS)) {
            // 检查库存
            Integer stock = getStockFromRedis(productId);
            if (stock <= 0) {
                return false;
            }
            // 扣减库存
            redisTemplate.opsForValue().decrement("seckill:stock:" + productId);
            return true;
        }
        return false;
    } finally {
        if (lock.isHeldByCurrentThread()) {
            lock.unlock();
        }
    }
}
```

**方案对比**：

| 方案 | 性能 | 实现复杂度 | 适用场景 |
| --- | --- | --- | --- |
| Redis Lua | ⭐⭐⭐⭐⭐ | 中 | 推荐，高并发首选 |
| 数据库乐观锁 | ⭐⭐ | 低 | 中小规模 |
| 分布式锁 | ⭐⭐⭐ | 高 | 需要强一致性 |

### 3.4 异步处理：削峰填谷

#### 消息队列架构

```arduino
用户请求 → 秒杀服务（生成订单消息）→ MQ → 订单服务（消费消息）→ 数据库
              ↓
         快速返回"排队中"
```

#### 生产者：发送秒杀请求

```scss
@Service
public class SeckillService {
    
    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    
    @Autowired
    private RedisTemplate redisTemplate;
    
    public Result seckill(Long productId, Long userId) {
        // 1. 限流检查
        if (!rateLimiter.tryAcquire()) {
            return Result.fail("系统繁忙");
        }
        
        // 2. Redis 扣减库存（Lua 脚本）
        boolean success = deductStockByLua(productId, userId);
        if (!success) {
            return Result.fail("商品已售罄");
        }
        
        // 3. 发送订单消息到 MQ
        SeckillOrder order = new SeckillOrder();
        order.setProductId(productId);
        order.setUserId(userId);
        order.setStatus(0);  // 待处理
        
        rocketMQTemplate.asyncSend("seckill-order", order, new SendCallback() {
            @Override
            public void onSuccess(SendResult result) {
                log.info("订单消息发送成功: {}", order);
            }
            
            @Override
            public void onException(Throwable e) {
                log.error("订单消息发送失败", e);
                // 补偿：恢复库存
                restoreStock(productId);
            }
        });
        
        // 4. 返回排队状态
        return Result.success("排队中，请稍候查看结果");
    }
}
```

#### 消费者：异步创建订单

```less
@Service
@RocketMQMessageListener(
    topic = "seckill-order",
    consumerGroup = "seckill-order-consumer"
)
public class OrderConsumer implements RocketMQListener<SeckillOrder> {
    
    @Autowired
    private OrderMapper orderMapper;
    
    @Autowired
    private ProductMapper productMapper;
    
    @Override
    public void onMessage(SeckillOrder order) {
        try {
            // 创建订单
            Order dbOrder = new Order();
            dbOrder.setProductId(order.getProductId());
            dbOrder.setUserId(order.getUserId());
            dbOrder.setStatus(1);  // 待支付
            dbOrder.setCreateTime(new Date());
            
            orderMapper.insert(dbOrder);
            
            // 扣减数据库库存（保证最终一致性）
            productMapper.decrementStock(order.getProductId());
            
            // 更新 Redis 中订单状态（供用户查询）
            redisTemplate.opsForValue().set(
                "seckill:order:" + order.getUserId() + ":" + order.getProductId(),
                JSON.toJSONString(dbOrder),
                1, TimeUnit.HOURS
            );
            
        } catch (Exception e) {
            log.error("创建订单失败", e);
            // 恢复库存
            restoreStock(order.getProductId());
        }
    }
}
```

### 3.5 热点隔离：独立部署

```yaml
# 秒杀服务独立部署
apiVersion: apps/v1
kind: Deployment
metadata:
  name: seckill-service
spec:
  replicas: 10
  selector:
    matchLabels:
      app: seckill
  template:
    spec:
      containers:
      - name: seckill
        image: registry.example.com/seckill:v1
        resources:
          requests:
            cpu: "2"
            memory: "4Gi"
          limits:
            cpu: "4"
            memory: "8Gi"
---
# 独立的 Redis 集群
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: seckill-redis
spec:
  replicas: 6  # 3主3从
  # ...
```

* * *

## 四、完整架构图

```css
┌─────────────────────────────────────────────────────────────────┐
│                          用户层                                  │
│    [Web/App] → [CDN 静态资源] → [验证码服务]                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                          网关层                                  │
│    [Nginx 限流] → [API Gateway 限流/鉴权] → [Sentinel 熔断]      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        秒杀服务层                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ 实例 1   │  │ 实例 2   │  │ 实例 3   │  │ 实例 N   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│       ↓              ↓              ↓              ↓             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              本地缓存（Caffeine）                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         缓存层                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ Redis M1 │  │ Redis M2 │  │ Redis M3 │   （Redis Cluster）   │
│  └──────────┘  └──────────┘  └──────────┘                      │
│       ↓              ↓              ↓                            │
│  [库存扣减 Lua]  [订单状态]  [用户购买记录]                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        消息队列                                  │
│         [RocketMQ/Kafka] ← 异步削峰                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        订单服务                                  │
│     [消费者] → [创建订单] → [扣减 DB 库存] → [通知用户]           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        数据库层                                  │
│     [主库：订单/库存] ← [从库：查询]                              │
└─────────────────────────────────────────────────────────────────┘
```

* * *

## 五、关键问题解决方案

### 5.1 防止超卖

```kotlin
// 方案：Redis Lua + 数据库乐观锁双重保障
public boolean deductStock(Long productId, Long userId) {
    // 第一层：Redis Lua 扣减
    boolean redisSuccess = deductStockByLua(productId, userId);
    if (!redisSuccess) {
        return false;
    }
    
    // 第二层：数据库乐观锁
    int dbRows = productMapper.decrementStock(productId);
    if (dbRows == 0) {
        // 数据库扣减失败，恢复 Redis 库存
        redisTemplate.opsForValue().increment("seckill:stock:" + productId);
        return false;
    }
    
    return true;
}
```

### 5.2 防止重复购买

```vbnet
// Redis Set 记录已购买用户
public boolean checkAndMarkBought(Long productId, Long userId) {
    String key = "seckill:bought:" + productId;
    // SADD 返回 1 表示新添加，0 表示已存在
    Long result = redisTemplate.opsForSet().add(key, userId.toString());
    return result != null && result == 1;
}
```

### 5.3 查询订单状态

```vbnet
// 轮询接口
public Result queryOrderStatus(Long productId, Long userId) {
    String key = "seckill:order:" + userId + ":" + productId;
    String orderJson = redisTemplate.opsForValue().get(key);
    
    if (orderJson != null) {
        Order order = JSON.parseObject(orderJson, Order.class);
        return Result.success(order);
    }
    
    // 检查是否在排队中
    if (redisTemplate.opsForSet().isMember("seckill:bought:" + productId, userId.toString())) {
        return Result.success("排队中，请稍候");
    }
    
    return Result.fail("未参与秒杀");
}
```

### 5.4 异常补偿机制

```scss
// 定时任务补偿：检查 Redis 和数据库一致性
@Scheduled(fixedRate = 60000)  // 每分钟执行
public void checkStockConsistency() {
    List<SeckillProduct> products = getActiveProducts();
    for (SeckillProduct product : products) {
        Integer redisStock = getStockFromRedis(product.getId());
        Integer dbStock = product.getStock();
        
        if (!redisStock.equals(dbStock)) {
            log.warn("库存不一致，产品ID: {}, Redis: {}, DB: {}", 
                product.getId(), redisStock, dbStock);
            // 以数据库为准，同步到 Redis
            redisTemplate.opsForValue().set(
                "seckill:stock:" + product.getId(), 
                String.valueOf(dbStock)
            );
        }
    }
}
```

* * *

## 六、性能优化 Checklist

| 优化项 | 实施方案 | 效果 |
| --- | --- | --- |
| CDN 加速 | 静态资源、商品图片 | 减少服务器压力 70% |
| 页面静态化 | 秒杀页面 HTML 静态化 | 减少渲染时间 |
| 按钮置灰 | 前端防重复点击 | 减少 80% 无效请求 |
| 验证码 | 图形验证码/滑块验证 | 防止脚本攻击 |
| URL 动态化 | 秒杀开始后才暴露 URL | 防止提前刷接口 |
| 限流 | 网关 + 应用层双重限流 | 保护系统稳定 |
| 缓存预热 | 提前加载热点数据 | 避免缓存击穿 |
| 本地缓存 | Caffeine 缓存商品信息 | 减少网络开销 |
| 异步下单 | MQ 削峰 | 提升吞吐量 10 倍 |
| 库存预热 | Redis 提前加载库存 | 避免数据库压力 |
| 热点隔离 | 独立部署秒杀服务 | 不影响主业务 |
| 降级兜底 | 非核心功能降级 | 保证核心流程 |

* * *

## 七、监控与告警

### 7.1 核心监控指标

```markdown
# Prometheus 监控配置
scrape_configs:
  - job_name: 'seckill-service'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['seckill-service:8080']

# 关键指标
- 秒杀接口 QPS
- 接口响应时间（P99、P95）
- 库存扣减成功率
- MQ 消息堆积量
- Redis 命中率
- 数据库连接池使用率
```

### 7.2 告警规则

```yaml
# AlertManager 告警规则
groups:
  - name: seckill-alerts
    rules:
      - alert: HighQPS
        expr: rate(http_requests_total{uri="/seckill"}[1m]) > 50000
        for: 1m
        annotations:
          summary: "秒杀接口 QPS 过高"
          
      - alert: LowStock
        expr: redis_stock < 10
        annotations:
          summary: "库存即将耗尽"
          
      - alert: MQBacklog
        expr: rocketmq_consumer_lag > 10000
        annotations:
          summary: "MQ 消息堆积严重"
```

* * *

## 八、面试高频问题

1.  **秒杀系统如何防止超卖？**
    
    1.  Redis Lua 脚本 + 数据库乐观锁双重保障
2.  **如何防止用户重复购买？**
    
    1.  Redis Set 记录已购买用户，或使用 Lua 脚本检查
3.  **秒杀系统如何限流？**
    
    1.  前端：按钮置灰、验证码
    2.  网关：Nginx、Gateway 限流
    3.  应用：RateLimiter、Sentinel
4.  **Redis 和数据库库存如何保持一致？**
    
    1.  Redis 扣减成功后发送 MQ
    2.  消费者异步扣减数据库
    3.  定时任务补偿检查
5.  **秒杀系统如何抗住高并发？**
    
    1.  多级缓存、消息队列削峰、热点隔离、限流降级

* * *

## 写在最后

秒杀系统是高并发架构的经典场景，涉及的技术点非常全面。掌握秒杀系统设计，就等于掌握了高并发架构的核心思想。

**核心原则**：

-   能在客户端做的，不要到服务端
-   能在缓存做的，不要到数据库
-   能异步做的，不要同步

希望这篇文章能帮你建立秒杀系统的完整知识体系！
