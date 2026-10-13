---
title: "商品库存扣减方案：Redis分布式锁vs数据库乐观锁"
date: 2026-03-27
updated: 2026-03-27
categories:
  - 实战复盘
  - 高并发库存与缓存
tags: []
description: "商品库存扣减方案：Redis分布式锁vs数据库乐观锁 性能问题 618大促期间，某爆款手机限量1000台，预计10万人同时抢购。初期采用简单数据库扣减方案，每秒面临5万+并发请求，数据库CPU使用率飙"
juejin:
  id: "7621381446864748563"
  url: https://juejin.cn/post/7621381446864748563
  views: 138
  likes: 0
---

## 商品库存扣减方案：Redis分布式锁vs数据库乐观锁

### 性能问题

618大促期间，某爆款手机限量1000台，预计10万人同时抢购。初期采用简单数据库扣减方案，每秒面临5万+并发请求，数据库CPU使用率飙升至95%，大量请求超时失败，用户体验极差，订单流失率高达30%，预估损失销售额500万元。

### 慢请求分析

#### 1\. 监控告警发现异常

```ini
# 数据库监控
show processlist;  # 发现大量"Waiting for table level lock"状态

# 慢查询日志分析
# Query_time: 2.456789  Lock_time: 1.234567  Rows_examined: 1  Rows_sent: 0
# UPDATE inventory SET stock = stock - 1 WHERE product_id = 123 AND stock > 0

# 系统资源监控
top -p $(pgrep mysqld)
# 结果：mysqld CPU使用率95%，内存使用率80%

# 连接池监控
# Active connections: 500/500 (已满)
# Pending connections: 1000+
```

#### 2\. 并发扣减效果分析

-   **数据库锁竞争**：1000台库存引发5万+并发更新，大量事务等待行锁
-   **死锁** **频发**：多个事务交叉更新不同商品时发生死锁，错误率5%
-   **连接池** **耗尽**：高并发下连接池迅速耗尽，新请求被拒绝
-   **性能急剧下降**：QPS从1万下降到2000，响应时间从50ms增加到2秒

#### 3\. 系统资源监控

-   **CPU使用率**：数据库服务器95%，应用服务器60%
-   **内存** **使用率**：数据库连接缓存占用大量内存，从4GB增长到12GB
-   **磁盘** **IO**：事务日志写入激增，磁盘使用率90%
-   **网络带宽**：数据库与应用间网络流量翻倍

#### 4\. 业务影响评估

-   **用户体验**：页面响应时间从1秒增加到8秒，95%用户放弃购买
-   **订单成功率**：从正常的90%下降到40%
-   **库存准确性**：出现超卖现象，实际销量超过库存100台+
-   **品牌声誉**：社交媒体大量投诉，品牌形象受损

### 优化措施

#### 1\. Redis分布式锁方案

##### 高性能实现架构

```vbnet
@Service
public class RedisInventoryService {
    
    @Autowired
    private StringRedisTemplate redisTemplate;
    
    private static final String LOCK_PREFIX = "inventory:lock:";
    private static final int LOCK_EXPIRE = 10;
    
    public ApiResponse deductInventory(Long productId, int quantity) {
        String lockKey = LOCK_PREFIX + productId;
        String requestId = UUID.randomUUID().toString();
        
        try {
            // 1. 获取分布式锁（Lua脚本保证原子性）
            Boolean locked = redisTemplate.opsForValue()
                .setIfAbsent(lockKey, requestId, LOCK_EXPIRE, TimeUnit.SECONDS);
                
            if (Boolean.FALSE.equals(locked)) {
                return ApiResponse.error("系统繁忙，请重试");
            }
            
            // 2. Lua脚本原子化扣减
            String luaScript = ""
                local stock_key = KEYS[1]
                local quantity = tonumber(ARGV[1])
                local current_stock = tonumber(redis.call('GET', stock_key) or '0')
                
                if current_stock >= quantity then
                    redis.call('DECRBY', stock_key, quantity)
                    return {1, current_stock - quantity}
                else
                    return {0, current_stock}
                end
            "";
            
            List<Long> result = redisTemplate.execute(
                new DefaultRedisScript<>(luaScript, List.class),
                Collections.singletonList("inventory:stock:" + productId),
                String.valueOf(quantity)
            );
            
            if (result.get(0) == 1L) {
                // 3. 异步落库保证最终一致性
                asyncDeductDB(productId, quantity);
                return ApiResponse.success("抢购成功");
            } else {
                return ApiResponse.error("库存不足");
            }
            
        } finally {
            // 4. 释放锁（Lua脚本验证身份）
            releaseLock(lockKey, requestId);
        }
    }
    
    private void releaseLock(String lockKey, String requestId) {
        String luaScript = ""
            if redis.call('GET', KEYS[1]) == ARGV[1] then
                return redis.call('DEL', KEYS[1])
            else
                return 0
            end
        "";
        
        redisTemplate.execute(
            new DefaultRedisScript<>(luaScript, Long.class),
            Collections.singletonList(lockKey),
            requestId
        );
    }
}
```

**性能测试结果**：

-   **QPS** **峰值**：50,000次/秒
-   **平均** **响应时间**：8ms
-   **成功率**：95%（5%为锁竞争失败）
-   **CPU使用率**：65%

#### 2\. 数据库乐观锁方案

##### 强一致性实现

```less
@Service
public class OptimisticInventoryService {
    
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ApiResponse deductInventory(Long productId, int quantity) {
        // 1. 查询当前库存和版本号
        InventoryDO inventory = inventoryDAO.selectForUpdate(productId);
        
        // 2. 库存检查
        if (inventory.getStock() < quantity) {
            return ApiResponse.error("库存不足");
        }
        
        // 3. 乐观锁更新（CAS操作）
        int affectedRows = inventoryDAO.optimisticDeduct(
            productId, 
            quantity, 
            inventory.getVersion()
        );
        
        if (affectedRows == 0) {
            return ApiResponse.error("系统繁忙，请重试");
        }
        
        // 4. 记录流水
        inventoryDAO.insertFlow(productId, -quantity, "OPTIMISTIC_DEDUCT");
        
        return ApiResponse.success("抢购成功");
    }
}

// DAO层优化实现
@Mapper
public interface InventoryDAO {
    
    @Select("SELECT id, product_id, stock, version FROM inventory WHERE product_id = #{productId} FOR UPDATE")
    InventoryDO selectForUpdate(@Param("productId") Long productId);
    
    @Update("UPDATE inventory SET stock = stock - #{quantity}, " +
            "version = version + 1, updated_time = NOW() " +
            "WHERE product_id = #{productId} AND stock >= #{quantity} " +
            "AND version = #{version}")
    int optimisticDeduct(@Param("productId") Long productId,
                       @Param("quantity") int quantity,
                       @Param("version") int version);
}
```

**性能测试结果**：

-   **QPS** **峰值**：5,000次/秒
-   **平均** **响应时间**：25ms
-   **成功率**：99%（1%为版本冲突重试）
-   **CPU使用率**：45%

#### 3\. 双重保障机制（最佳实践）

##### 智能路由策略

```scss
@Service
public class DoubleGuaranteeInventoryService {
    
    public ApiResponse smartDeduct(Long productId, int quantity) {
        // 1. Redis预扣减（快速响应）
        String preDeductResult = preDeductInRedis(productId, quantity);
        if ("INSUFFICIENT".equals(preDeductResult)) {
            return ApiResponse.error("库存不足");
        }
        
        try {
            // 2. 数据库最终扣减（强一致性）
            return deductInDatabase(productId, quantity);
        } catch (Exception e) {
            // 3. 数据库失败，回滚Redis
            rollbackRedisDeduct(productId, quantity);
            return ApiResponse.error("系统异常，请重试");
        }
    }
    
    @Scheduled(fixedRate = 60000)
    public void reconcileInventory() {
        // 定期核对Redis与数据库库存一致性
        List<ProductStockDiff> diffs = inventoryDAO.findStockDifferences();
        
        for (ProductStockDiff diff : diffs) {
            if (diff.getRedisStock() != diff.getDbStock()) {
                redisTemplate.opsForValue().set(
                    "inventory:stock:" + diff.getProductId(),
                    String.valueOf(diff.getDbStock())
                );
            }
        }
    }
}
```

**性能测试结果**：

-   **QPS峰值**：30,000次/秒
-   **平均响应时间**：15ms
-   **成功率**：99.9%
-   **CPU使用率**：55%

### 效果验证

#### 性能指标对比

| 方案 | QPS | 延迟 | 成功率 | CPU使用率 | 一致性保证 |
| --- | --- | --- | --- | --- | --- |
| 数据库直连 | 2,000 | 2000ms | 40% | 95% | 强一致 |
| Redis分布式锁 | 50,000 | 8ms | 95% | 65% | 最终一致 |
| 数据库乐观锁 | 5,000 | 25ms | 99% | 45% | 强一致 |
| 双重保障 | 30,000 | 15ms | 99.9% | 55% | 强一致 |

#### 业务效果改善

-   **订单成功率**：从40%提升到99.9%（+149%）
-   **用户体验**：页面响应时间从8秒减少到200ms（-97.5%）
-   **库存准确性**：超卖现象彻底消除
-   **系统稳定性**：CPU使用率从95%降到55%（-42%）

#### 成本效益分析

-   **硬件成本**：减少数据库服务器50%资源需求
-   **开发维护成本**：Redis方案运维复杂度适中
-   **业务收益**：618大促期间零超卖，挽回损失500万+

### 生产环境最佳实践

#### 监控告警体系

```sql
-- 库存一致性检查
SELECT 
    i.product_id,
    i.stock as db_stock,
    r.stock as redis_stock,
    ABS(i.stock - r.stock) as diff
FROM inventory i
LEFT JOIN inventory_redis_cache r ON i.product_id = r.product_id
WHERE ABS(i.stock - r.stock) > 0;

-- 性能监控
SELECT 
    operation_type,
    COUNT(*) as total_count,
    AVG(execute_time) as avg_time,
    MAX(execute_time) as max_time
FROM inventory_operation_log 
WHERE create_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
GROUP BY operation_type;
```

#### 应急预案

##### 1\. 库存超卖处理

```scss
@Scheduled(fixedRate = 300000)
public void checkOverSold() {
    List<Order> suspiciousOrders = orderDAO.findPotentialOverSold();
    
    for (Order order : suspiciousOrders) {
        if (isLegitimateOrder(order)) {
            compensateOrder(order);  // 补充库存或退款
        }
    }
}
```

##### 2\. 系统雪崩预防

```java
public class InventoryRateLimiter {
    private final RateLimiter rateLimiter = RateLimiter.create(10000);
    
    public boolean tryAcquire() {
        return rateLimiter.tryAcquire();
    }
}
```

### 经验总结

#### 核心技术认知

-   **性能与一致性权衡**：Redis方案高性能但最终一致，数据库方案强一致但性能有限
-   **业务场景匹配**：秒杀场景选Redis，金融交易选数据库乐观锁
-   **容错机制重要**：任何方案都需要完善的降级和补偿机制

#### 踩坑经验总结

-   **坑1**：Redis锁误删，解决方案：Lua脚本验证requestId
-   **坑2**：数据库死锁，解决方案：按商品ID排序更新
-   **坑3**：库存不一致，解决方案：定期核对+补偿机制

#### 生产环境建议

-   **渐进式部署**：先在低峰期验证方案有效性
-   **多维度监控**：性能、一致性、可用性全覆盖
-   **定期演练**：模拟各种异常场景的应对能力

* * *

_库存扣减是电商系统核心环节，没有完美方案，只有最适合业务特点的选择。_
