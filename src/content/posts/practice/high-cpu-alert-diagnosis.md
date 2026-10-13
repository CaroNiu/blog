---
title: "线上高CPU告警问题定位与处理实战指南"
pubDate: 2026-04-08
category: practice
series: 稳定性与可观测
tags: []
summary: "一、问题背景：为什么CPU飙高是高危信号 1.1 CPU飙高的业务影响链 真实影响： 某电商大促期间，CPU飙至95%后，订单接口响应从50ms飙至2秒，导致大量超时和重复下单 有赞技术团队案例：Ha"
draft: false
juejin:
  id: "7625992318693867562"
  url: https://juejin.cn/post/7625992318693867562
  views: 162
  likes: 0

---
## 一、问题背景：为什么CPU飙高是高危信号

### 1.1 CPU飙高的业务影响链

```markdown
CPU飙高 → 线程争抢时间片 → 请求响应变慢 → 队列积压 → 级联故障
    ↓
GC频繁触发 → Stop-The-World → 服务假死 → 雪崩效应
```

**真实影响**：

-   某电商大促期间，CPU飙至95%后，订单接口响应从50ms飙至2秒，导致大量超时和重复下单
-   有赞技术团队案例：HashBiMap并发操作导致死循环，CPU持续99%，服务运行两天后才发现

### 1.2 CPU飙高的常见根因分类

| 根因类型 | 典型场景 | 占比（经验值） |
| --- | --- | --- |
| **代码逻辑问题** | 死循环、无限递归、复杂算法 | 35% |
| **GC** **频繁** | 内存泄漏、堆内存不足、大对象分配 | 30% |
| **锁竞争/** **死锁** | synchronized滥用、锁粒度过粗 | 15% |
| **线程池** **配置不当** | 线程数过多、队列无界 | 12% |
| **外部因素** | 宿主机资源竞争、网络IO阻塞 | 8% |

* * *

## 二、标准排查流程：六步定位法

### 2.1 完整排查流程图

```vbnet
Step 1: 确认问题进程 (top / htop)
         ↓
Step 2: 定位问题线程 (top -Hp / jstack)
         ↓
Step 3: 获取线程堆栈 (jstack / Arthas thread)
         ↓
Step 4: 分析堆栈定位代码行
         ↓
Step 5: 验证根因假设
         ↓
Step 6: 实施修复与验证
```

### 2.2 Step 1：确认问题进程

**使用 top 命令快速定位**：

```perl
# 进入top后按 P 键按CPU排序
top

# 或者直接指定排序
top -o %CPU

# 输出示例
  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
12345 app       20   0   12.1g   4.2g   128m S  92.8   8.2  4011:48 java
```

**如果Java进程多，使用 jps 辅助确认**：

```bash
jps -l
# 输出
12345 com.example.MainApplication
23456 org.apache.catalina.startup.Bootstrap
```

**关键指标解读**：

-   `%CPU`：超过70%需警惕，超过90%必须处理
-   `TIME+`：累计CPU时间，异常长可能是长期问题
-   `S`（状态）：R=运行中，S=睡眠，D=不可中断睡眠（通常是IO）

### 2.3 Step 2：定位问题线程

**top -Hp 查看进程内线程**：

```perl
# -H 显示线程，-p 指定进程ID
top -Hp 12345

# 输出示例
  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
12347 app       20   0   12.1g   4.2g   128m R  51.0   8.2  2005:12 java
12349 app       20   0   12.1g   4.2g   128m R  48.5   8.2  2005:10 java
12351 app       20   0   12.1g   4.2g   128m S   0.3   8.2    10:05 java
```

**记录高CPU线程的** **PID**：上例中 12347 和 12349 是问题线程。

### 2.4 Step 3：获取线程堆栈

**方法一：** **jstack** **传统方式**

```bash
# 将线程ID转为16进制
printf '%x\n' 12347
# 输出: 303b

# 获取该线程的堆栈信息
jstack 12345 | grep '303b' -A 30 --color

# 输出示例
"http-nio-8080-exec-10" #12347 prio=5 os_prio=0 tid=0x00007f8c84001800 nid=0x303b runnable [0x00007f8c7a3fe000]
   java.lang.Thread.State: RUNNABLE
        at com.example.OrderService.processBatch(OrderService.java:127)
        at com.example.OrderService$$FastClassBySpringCGLIB$$1.invoke(<generated>)
        at org.springframework.cglib.proxy.MethodProxy.invoke(MethodProxy.java:218)
```

**方法二：Arthas 更高效**

Arthas 是阿里开源的Java诊断工具，`thread` 命令直接展示CPU最高的线程：

```yaml
# 下载并启动 Arthas
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# 查看CPU占用最高的前3个线程
[arthas@12345]$ thread -n 3
Threads Total: 112, NEW: 0, RUNNABLE: 26, BLOCKED: 0, WAITING: 31, TIMED_WAITING: 55
ID   NAME                      STATE       %CPU  TIME
108  http-nio-8080-exec-10    RUNNABLE    51    4011:48
100  http-nio-8080-exec-2     RUNNABLE    48    4011:51

# 查看具体线程的堆栈
[arthas@12345]$ thread 108
"http-nio-8080-exec-10" Id=108 cpuUsage=51% RUNNABLE
    at com.google.common.collect.HashBiMap.seekByKey(HashBiMap.java)
    at com.google.common.collect.HashBiMap.put(HashBiMap.java:270)
    at com.google.common.collect.HashBiMap.forcePut(HashBiMap.java:263)
    at com.example.OaInfoManager.syncUserCache(OaInfoManager.java:159)
```

**Arthas 的优势**：

-   直接显示CPU占用率，无需手动转换
-   支持实时监控和动态诊断
-   可在线反编译、热更新代码

### 2.5 Step 4：分析堆栈定位代码

**堆栈分析要点**：

1.  **关注** **RUNNABLE** **状态的线程**
    
    1.  正在执行代码，是CPU消耗的直接来源
2.  **从堆栈顶部开始分析**
    
    1.  顶部方法是当前正在执行的方法
3.  **区分业务代码和框架代码**
    
    1.  业务代码：`com.yourcompany.xxx`
    2.  框架代码：`org.springframework`、`java.util`
4.  **重复采样确认**
    
    1.  多次执行 `thread id` 或 `jstack`，如果堆栈一直停留在同一方法，基本确定问题点

**示例分析**：

```csharp
// 堆栈显示一直停留在这段代码
at com.example.DataProcessor.calculateScore(DataProcessor.java:89)

// 查看源码发现是死循环
public void calculateScore(List<Item> items) {
    int i = 0;
    while (i < items.size()) {  // Bug: i 没有自增
        processItem(items.get(i));
    }
}
```

### 2.6 Step 5：验证根因假设

**使用 Arthas** **tt** **命令追踪方法调用**：

```ruby
# 监控 HashBiMap.seekByKey 方法的调用参数
[arthas@12345]$ tt -t com.google.common.collect.HashBiMap seekByKey -n 100

# 输出显示方法调用情况，可看到是否存在死循环或异常参数
INDEX   TIMESTAMP              COST(ms)   OBJECT     METHOD               RESULT
1000    2025-04-08 10:30:15    0.001      @BiEntry   seekByKey            @BiEntry[key=张三, value=1111]
```

**有赞案例中的发现**：

-   使用 tt 追踪发现 HashBiMap 中存在 `张三 -> 李四 -> 张三` 的环状引用
-   原因是并发调用 `forcePut` 导致数据不一致
-   解决方案：对 `syncUserCache` 方法加 `synchronized`

* * *

## 三、高级分析工具：火焰图与 perf

### 3.1 火焰图是什么

火焰图（Flame Graph）是一种**可视化** **性能分析工具**，直观展示程序的调用栈和CPU时间分布。

**核心特点**：

-   **X轴**：采样次数（即CPU时间占比），宽度越大表示占用越多
-   **Y轴**：调用栈深度，从下往上是调用链
-   **颜色**：无特殊含义，仅用于区分不同函数

**如何阅读火焰图**：

1.  关注**顶部平顶**（plateaus），代表正在消耗CPU的函数
2.  但更好的做法：**先看业务函数宽度**，再往顶部找第一个库函数
3.  搜索功能：Ctrl+F 高亮特定函数

### 3.2 使用 perf 生成火焰图

**Step 1：采集性能数据**

```r
# -F 99 每秒采样99次，-g 记录调用栈，sleep 30 采样30秒
perf record -F 99 -p 12345 -g -- sleep 30

# 或者使用 --call-graph dwarf 获取更完整的调用栈
perf record -F 99 -p 12345 --call-graph dwarf -- sleep 30
```

**Step 2：生成火焰图**

```csharp
# 安装 FlameGraph 工具
git clone https://github.com/brendangregg/FlameGraph.git

# 转换格式并生成 SVG
perf script > out.perf
FlameGraph/stackcollapse-perf.pl out.perf > out.folded
FlameGraph/flamegraph.pl out.folded > cpu_flamegraph.svg
```

**Linux 新版本可以直接生成**：

```bash
# 内置火焰图生成（较新版本）
perf script flamegraph -a -F 99 -p 12345 sleep 20
# 输出：flamegraph.html
```

### 3.3 火焰图案例分析

**案例：定时器导致的 sys 飙高**

某应用CPU利用率异常：`14.6% usr 38.5% sys 36.2% idle`

通过火焰图分析：

-   发现内核函数 `sys_rt_sigtimedwait` 占 22.69%
-   `sys_mq_timedsend` 和 `sys_mq_timedreceive` 共占约 28%
-   定位原因：应用中定时器操作过于频繁
-   定时器中断从 200/S 上升到 2100/S

**解决方案**：

-   合并小粒度定时任务
-   使用时间轮替代大量 Timer
-   调整定时器精度需求

* * *

## 四、GC导致的CPU飙高排查

### 4.1 判断是否是GC问题

**使用** **jstat** **监控** **GC**：

```yaml
# 每秒输出一次，共输出10次
jstat -gcutil 12345 1s 10

# 输出示例
  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
  0.00  50.00  85.30  95.80  95.32  92.15   1024   15.234    50   12.531   27.765
  0.00  50.00  90.10  96.20  95.32  92.15   1025   15.245    51   12.542   27.787
  0.00  50.00  95.50  98.50  95.32  92.15   1026   15.256    52   12.553   27.809
```

**关键指标**：

-   **FGC**（Full GC次数）：如果持续增加，说明存在内存问题
-   **O**（老年代使用率）：接近100%会触发Full GC
-   **GCT**（总GC时间）：如果增长过快，说明GC频繁

**确认是** **GC** **问题**：

```perl
# 查看 jstack 中 GC 线程状态
jstack 12345 | grep -A 5 "GC"

# 如果看到大量线程状态为 BLOCKED，且堆栈在 GC 相关代码，基本确认
```

### 4.2 GC问题的常见原因

1.  **内存泄漏**
    
    1.  对象无法被回收，老年代持续增长
    2.  排查：`jmap -histo:live 12345 | head -20` 查看对象数量
2.  **大对象分配**
    
    1.  单次分配超过 Eden 区一半，直接进老年代
    2.  排查：检查是否有大批量数据处理逻辑
3.  **显式** **GC** **调用**
    
    1.  代码中调用 `System.gc()`
    2.  解决：添加 JVM 参数 `-XX:+DisableExplicitGC`
4.  **堆内存** **不足**
    
    1.  配置的堆太小，GC频率高
    2.  解决：调大 `-Xmx` 参数

### 4.3 GC问题排查实战

**场景**：某电商大促期间服务不可用

```perl
# 1. 确认是GC问题
jstat -gcutil 12345 1s
# FGC 持续增长，O 接近 100%

# 2. 生成堆转储
jmap -dump:format=b,file=heap.hprof 12345

# 3. 使用 MAT 分析
# 发现 OrderService 中的 List<Order> 对象数量异常
# 每个 Order 对象包含大量未使用的字段

# 4. 定位代码
jstack 12345 | grep "OrderService" -A 10
# 发现批量处理订单时，一次性加载了所有订单到内存

# 5. 修复方案
# - 改为分批处理，每批1000条
# - 使用游标方式处理，而非一次性加载
```

* * *

## 五、死锁问题排查

### 5.1 jstack 自动检测死锁

```vbnet
jstack 12345

# 如果存在死锁，会在输出末尾显示：
Found one Java-level deadlock:
=============================
"Thread-1":
    waiting to lock monitor 0x00007f8c84001a00 (object 0x00000000d1234567, a java.lang.Object),
    which is held by "Thread-2"
"Thread-2":
    waiting to lock monitor 0x00007f8c84001b00 (object 0x00000000d1234568, a java.lang.Object),
    which is held by "Thread-1"

Java stack information for the threads listed above:
===================================================
"Thread-1":
    at com.example.ServiceA.methodA(ServiceA.java:20)
    - waiting to lock <0x00000000d1234567>
"Thread-2":
    at com.example.ServiceB.methodB(ServiceB.java:30)
    - waiting to lock <0x00000000d1234568>
```

### 5.2 死锁的典型场景

**场景一：锁顺序不一致**

```javascript
// 线程1
synchronized(lockA) {
    synchronized(lockB) { ... }
}

// 线程2
synchronized(lockB) {
    synchronized(lockA) { ... }
}
```

**场景二：数据库** **死锁**

```sql
-- 事务1
UPDATE orders SET status = 'PAID' WHERE id = 1;  -- 锁住订单1
UPDATE inventory SET stock = stock - 1 WHERE id = 101;  -- 等待库存101

-- 事务2（并发执行）
UPDATE inventory SET stock = stock - 1 WHERE id = 101;  -- 锁住库存101
UPDATE orders SET status = 'PAID' WHERE id = 1;  -- 等待订单1
```

**解决方案**：

-   统一加锁顺序
-   使用 `tryLock` 设置超时
-   减小锁粒度
-   使用乐观锁替代悲观锁

* * *

## 六、完整案例复盘：HashBiMap并发死循环

**来源**：有赞技术团队真实案例

**现象**：

-   服务器CPU持续99%
-   服务流量不大，但把自己"累坏了"
-   服务运行两天后才发现问题

**排查过程**：

```perl
# 1. top 确认 Java 进程
top -p 384
# CPU: 99%

# 2. Arthas 查看高CPU线程
[arthas@384]$ thread
Threads Total: 112
ID   NAME                      STATE       %CPU  TIME
108  http-nio-7001-exec-0     RUNNABLE    51    4011:48
100  http-nio-7001-exec-2     RUNNABLE    48    4011:51

# 3. 查看线程堆栈
[arthas@384]$ thread 108
"http-nio-7001-exec-0" Id=108 cpuUsage=51% RUNNABLE
    at com.google.common.collect.HashBiMap.seekByKey(HashBiMap.java)
    at com.google.common.collect.HashBiMap.put(HashBiMap.java:270)
    at com.google.common.collect.HashBiMap.forcePut(HashBiMap.java:263)
    at com.yourcompany.OaInfoManager.syncUserCache(OaInfoManager.java:159)

# 4. 使用 tt 追踪方法参数
[arthas@384]$ tt -t com.google.common.collect.HashBiMap seekByKey -n 100

# 发现存在环状引用：张三 -> 李四 -> 张三
# 原因：并发调用 forcePut 导致数据不一致
```

**根因**：

-   `HashBiMap` 不支持并发操作
-   多个线程同时调用 `forcePut`，导致内部数据结构出现环
-   环状链表导致 `seekByKey` 进入死循环

**修复方案**：

```arduino
// 修复前
public void syncUserCache(User user) {
    biMap.forcePut(user.getName(), user.getId());
}

// 修复后
public synchronized void syncUserCache(User user) {
    biMap.forcePut(user.getName(), user.getId());
}

// 或者使用线程安全的替代方案
private final ConcurrentHashMap<String, Long> userCache = new ConcurrentHashMap<>();
```

* * *

## 七、预防与监控体系建设

### 7.1 监控告警配置

**关键指标**：

| 指标 | 阈值 | 告警级别 |
| --- | --- | --- |
| CPU使用率 | \> 70% 持续5分钟 | P2 |
| CPU使用率 | \> 90% 持续1分钟 | P1 |
| Full GC频率 | \> 1次/分钟 | P2 |
| 线程BLOCKED数量 | \> 10 | P2 |
| 线程数 | \> 线程池最大值 | P3 |

**监控工具推荐**：

-   **基础监控**：Prometheus + Grafana
-   **APM**：SkyWalking、Jaeger、Zipkin
-   **JVM** **监控**：JConsole、VisualVM、Arthas Dashboard

### 7.2 代码层面预防

**1.** **线程池** **规范配置**

```java
// 错误：使用无界队列
ExecutorService executor = Executors.newFixedThreadPool(100);

// 正确：有界队列 + 拒绝策略
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,  // 核心线程数
    50,  // 最大线程数
    60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),  // 有界队列
    new ThreadPoolExecutor.CallerRunsPolicy()  // 拒绝策略
);
```

**2\. 避免显式** **GC** **调用**

```scss
// 错误
System.gc();

// JVM启动参数添加
-XX:+DisableExplicitGC
```

**3\. 锁使用** **最佳实践**

```csharp
// 使用 tryLock 避免死锁
if (lock.tryLock(3, TimeUnit.SECONDS)) {
    try {
        // 业务逻辑
    } finally {
        lock.unlock();
    }
} else {
    // 获取锁失败处理
    log.warn("获取锁超时");
}
```

### 7.3 应急预案

**P1 告警处理流程**：

```markdown
1. 收到告警 → 2分钟内响应
2. top 确认进程 → 1分钟
3. Arthas/jstack 定位线程 → 3分钟
4. 分析堆栈定位代码 → 5分钟
5. 决策：重启服务 / 热修复 / 限流降级 → 5分钟
```

**快速止损手段**：

-   **重启** **服务**：最快恢复，但可能丢失现场
-   **限流降级**：保留现场，降低流量
-   **Arthas热更新**：无需重启，直接修复代码

* * *

## 八、工具速查表

| 场景 | 工具 | 命令示例 |
| --- | --- | --- |
| 查看进程CPU | top / htop | `top -p <pid>` |
| 查看线程CPU | top -Hp | `top -Hp <pid>` |
| 线程堆栈 | jstack | `jstack | grep '' -A 30` |
| Arthas线程分析 | thread | `thread -n 5` |
| 监控GC | jstat | `jstat -gcutil <pid> 1s` |
| 堆内存分析 | jmap + MAT | `jmap -dump:format=b,file=heap.hprof <pid>` |
| 方法追踪 | Arthas tt | `tt -t com.xxx.Service method -n 100` |
| 火焰图生成 | perf + FlameGraph | `perf record -F 99 -p <pid> -g -- sleep 30` |
| 实时热点 | perf top | `perf top -p <pid>` |

* * *

## 九、总结

### 排查核心原则

1.  **先定位，后优化**：不要盲目优化，先找到真正的问题点
2.  **工具组合使用**：top → jstack/Arthas → 火焰图，层层深入
3.  **保留现场**：不要急于重启，先收集堆栈和堆转储
4.  **验证假设**：定位到疑似代码后，通过tt、trace等验证

### 能力进阶路径

```yaml
Level 1: 能用 top/jstack 基本排查
    ↓
Level 2: 熟练使用 Arthas 进行在线诊断
    ↓
Level 3: 能分析火焰图，定位复杂性能问题
    ↓
Level 4: 建立完善的监控告警体系，问题发现于萌芽
    ↓
Level 5: 架构层面预防，设计高可用、高性能系统
```

* * *

## 参考资料

-   [Java性能调优实战指南 - 腾讯云](https://link.juejin.cn?target=https%3A%2F%2Fcloud.tencent.com%2Fdeveloper%2Farticle%2F2595527 "https://cloud.tencent.com/developer/article/2595527")
-   [利用Arthas精准定位CPU负载过高问题 - 有赞技术团队](https://link.juejin.cn?target=https%3A%2F%2Ftech.youzan.com%2Farthas-fix-high-cpu%2F "https://tech.youzan.com/arthas-fix-high-cpu/")
-   [线上CPU飙升100%问题排查 - 博客园](https://link.juejin.cn?target=https%3A%2F%2Fwww.cnblogs.com%2Fdennyzhangdd%2Fp%2F11585971.html "https://www.cnblogs.com/dennyzhangdd/p/11585971.html")
-   [如何读懂火焰图 - 阮一峰](https://link.juejin.cn?target=https%3A%2F%2Fwww.ruanyifeng.com%2Fblog%2F2017%2F09%2Fflame-graph.html "https://www.ruanyifeng.com/blog/2017/09/flame-graph.html")
-   [Arthas官方文档](https://link.juejin.cn?target=https%3A%2F%2Farthas.aliyun.com%2Fdoc%2F "https://arthas.aliyun.com/doc/")
-   [Perf使用、CPU飙高问题排查 - 掘金](https://juejin.cn/post/7502368089733070858 "https://juejin.cn/post/7502368089733070858")
