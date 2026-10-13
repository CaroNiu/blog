---
title: "可观测性体系：日志、指标、链路追踪"
pubDate: 2026-03-25
category: backend
series: 稳定性与可观测
tags: []
summary: "可观测性体系：日志、指标、链路追踪 一、什么是可观测性？ 1.1 三大支柱 类型 用途 示例 日志 事件详情 错误详情、调试信息 指标 趋势分析 QPS、响应时间、错误率 链路 请求追踪 调用链、依赖"
draft: false
juejin:
  id: "7620826561294778411"
  url: https://juejin.cn/post/7620826561294778411
  views: 130
  likes: 1

---
## 可观测性体系：日志、指标、链路追踪

> 可观测性是生产系统的"眼睛"。本文构建完整的可观测性体系。

* * *

### 一、什么是可观测性？

#### 1.1 三大支柱

```markdown
        ┌─────────────────┐
        │   可观测性       │
        │  Observability  │
        └────────┬────────┘
                 │
        ┌────────┼────────┐
        │        │        │
   ┌────▼───┐ ┌─▼─────┐ ┌▼─────┐
   │  Logs  │ │Metrics│ │Traces│
   │  日志  │ │ 指标  │ │ 链路 │
   └────────┘ └───────┘ └──────┘
```

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| 日志 | 事件详情 | 错误详情、调试信息 |
| 指标 | 趋势分析 | QPS、响应时间、错误率 |
| 链路 | 请求追踪 | 调用链、依赖关系 |

* * *

### 二、日志系统

#### 2.1 ELK 架构

```
应用日志 → Filebeat → Kafka → Logstash → Elasticsearch → Kibana
```

#### 2.2 Spring Boot 集成

```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

```xml
<!-- logback-spring.xml -->
<appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <includeContext>true</includeContext>
        <includeMdc>true</includeMdc>
    </encoder>
</appender>
```

#### 2.3 日志规范

```lua
// ✅ 结构化日志
log.info("用户下单成功", kv("userId", userId), kv("orderId", orderId));

// 输出：{"timestamp":"2024-01-01","level":"INFO","msg":"用户下单成功","userId":"123","orderId":"456"}

// ❌ 避免
log.info("用户" + userId + "创建了订单" + orderId); // 不好解析
```

* * *

### 三、指标系统

#### 3.1 Prometheus + Grafana

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'spring-boot'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
```

```java
// Micrometer 指标
@Component
public class OrderMetrics {
    
    private final Counter orderCounter;
    private final Timer orderTimer;
    
    public OrderMetrics(MeterRegistry registry) {
        orderCounter = Counter.builder("orders.created")
            .tag("service", "order")
            .register(registry);
        orderTimer = Timer.builder("orders.duration")
            .register(registry);
    }
    
    public void recordOrder() {
        orderCounter.increment();
    }
    
    public void recordDuration(Runnable action) {
        orderTimer.record(action);
    }
}
```

#### 3.2 关键指标

| 指标 | 类型 | 意义 |
| --- | --- | --- |
| request_count | Counter | 总请求数 |
| request_duration | Histogram | 请求耗时分布 |
| error_rate | Gauge | 错误率 |
| jvm_memory_used | Gauge | JVM 内存使用 |
| thread_active | Gauge | 活跃线程数 |

* * *

### 四、链路追踪

#### 4.1 SkyWalking

```typescript
// 引入依赖
<dependency>
    <groupId>org.apache.skywalking</groupId>
    <artifactId>apm-toolkit-trace</artifactId>
</dependency>

// 自动追踪
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

#### 4.2 自定义追踪

```less
@Trace
@Tag(key = "userId", value = "arg[0]")
public User getUser(Long userId) {
    return userMapper.findById(userId);
}

// 记录自定义跨度
ActiveSpan.tag("custom_tag", "value");
```

#### 4.3 分布式链路

```less
// Feign 集成
@FeignClient(name = "user-service", configuration = TraceConfig.class)
public interface UserClient {
    @GetMapping("/users/{id}")
    User getUser(@PathVariable Long id);
}
```

* * *

### 五、统一可观测性平台

#### 5.1 OpenTelemetry

```less
// OpenTelemetry 统一标准
OpenTelemetrySdk.builder()
    .setTracerProvider(
        SdkTracerProvider.builder()
            .addSpanProcessor(
                BatchSpanProcessor.builder(
                    JaegerGrpcSpanExporter.builder()
                        .setEndpoint("http://jaeger:14250")
                        .build()
                ).build()
            )
            .build()
    )
    .build();
```

#### 5.2 一体化方案

```makefile
# 推荐架构
logs:
  - fluentd → Loki → Grafana
  
metrics:
  - app → Prometheus → Grafana
  
traces:
  - app → Jaeger/SkyWalking → Grafana

# Grafana 统一展示
```

* * *

### 六、告警配置

```yaml
# AlertManager
rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.01
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "错误率过高"
```

* * *
