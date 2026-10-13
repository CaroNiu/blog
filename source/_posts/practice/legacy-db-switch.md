---
title: "存量服务数据库切换实战指南"
date: 2026-03-31
updated: 2026-03-31
categories:
  - 实战复盘
tags: []
description: "存量服务数据库切换完整实战方案 数据库切换是技术团队的高风险操作。本文提供一套经过生产验证的完整方案，涵盖切换流程、风险防控、数据检测、故障回滚等关键环节。 一、切换前的准备工作 1.1 系统现状评估"
juejin:
  id: "7623087139460628534"
  url: https://juejin.cn/post/7623087139460628534
  views: 221
  likes: 0
---

## 存量服务数据库切换完整实战方案

数据库切换是技术团队的高风险操作。本文提供一套经过生产验证的完整方案，涵盖切换流程、风险防控、数据检测、故障回滚等关键环节。

* * *

### 一、切换前的准备工作

#### 1.1 系统现状评估

在动手之前，必须搞清楚以下信息：

```sql
□ 数据规模：总数据量、单表最大行数、日增量
□ 业务特征：QPS峰值、读写比例、慢查询占比
□ 依赖梳理：哪些服务直连数据库、有无跨库JOIN
□ 敏感时段：业务低峰期时间窗口
□ 容灾要求：RTO（恢复时间目标）、RPO（恢复点目标）
```

**示例评估报告：**

| 指标 | 现状 | 风险等级 |
| --- | --- | --- |
| 数据总量 | 2.3TB | 中 |
| 单表最大 | 订单表 1.8亿行 | 高 |
| 峰值QPS | 3500 | 中 |
| 慢查询 | 占比 0.3% | 低 |
| 直连服务数 | 12个 | 高 |
| 跨库JOIN | 3处 | 高 |

#### 1.2 数据迁移方案设计

根据数据量和业务特征，选择迁移策略：

| 场景 | 推荐方案 | 工具 |
| --- | --- | --- |
| 同构MySQL，< 500GB | 主从复制 + 切换 | MySQL Replication |
| 同构MySQL，> 500GB | 物理备份 + 追binlog | XtraBackup + canal |
| 异构迁移（如MySQL→PG） | 全量+增量迁移 | pg_chameleon / Debezium |
| 不停机迁移 | 双写 + 数据比对 | 自研同步工具 |

#### 1.3 双环境搭建

**新库环境必须包含：**

```markdown
# 新库架构示意
新库集群:
  - 主库 x1 (写入)
  - 从库 x2 (读取 + 高可用)
  - 监控: Prometheus + Grafana
  - 告警: 钉钉/企微机器人
  - 备份: 每日全量 + 实时binlog
```

**关键配置检查：**

```sql
-- MySQL配置核查
SHOW VARIABLES LIKE 'binlog_format';  -- 必须为 ROW
SHOW VARIABLES LIKE 'gtid_mode';      -- 建议开启GTID
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';  -- 建议物理内存的70%
```

* * *

### 二、数据迁移实施（以MySQL为例）

#### 2.1 全量数据迁移

**步骤1：创建新库并初始化**

```bash
# 使用XtraBackup进行物理备份（不影响主库性能）
innobackupex --user=backup --password=xxx --host=old-master /backup/

# 在新库恢复
innobackupex --apply-log /backup/2024-01-15/
innobackupex --copy-back /backup/2024-01-15/
chown -R mysql:mysql /var/lib/mysql
```

**步骤2：建立复制链路**

```ini
-- 在新库上执行
CHANGE MASTER TO
  MASTER_HOST='old-master.internal',
  MASTER_USER='repl',
  MASTER_PASSWORD='xxx',
  MASTER_LOG_FILE='mysql-bin.000123',
  MASTER_LOG_POS=456789;

START SLAVE;

-- 检查同步状态
SHOW SLAVE STATUS\G
-- 确认 Seconds_Behind_Master = 0
```

#### 2.2 增量数据同步

**方案A：基于Binlog的实时同步（推荐）**

```ini
// Canal客户端伪代码
CanalConnector connector = CanalConnectors.newSingleConnector(
    new InetSocketAddress("old-master", 11111), 
    "example", "", ""
);
connector.connect();
connector.subscribe("db.*");

while (running) {
    Message message = connector.getWithoutAck(1000);
    for (Entry entry : message.getEntries()) {
        // 解析binlog事件
        RowChange rowChange = RowChange.parseFrom(entry.getStoreValue());
        // 写入新库
        writeToNewDatabase(rowChange);
    }
    connector.ack(message.getId());
}
```

**方案B：基于触发器的双写（简单场景）**

```sql
-- 在旧库创建触发器，同步到新库
DELIMITER //

CREATE TRIGGER sync_order_insert
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
    INSERT INTO new_db.orders (id, user_id, amount, status, created_at)
    VALUES (NEW.id, NEW.user_id, NEW.amount, NEW.status, NEW.created_at);
END//

CREATE TRIGGER sync_order_update
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    UPDATE new_db.orders 
    SET user_id = NEW.user_id, amount = NEW.amount, status = NEW.status
    WHERE id = NEW.id;
END//

DELIMITER ;
```

#### 2.3 数据一致性校验

**全量校验脚本：**

```python
#!/usr/bin/env python3
"""数据一致性校验工具"""

import hashlib
import pymysql

def compute_checksum(conn, table, columns, batch_size=10000):
    """计算表的MD5校验和"""
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    total = cursor.fetchone()[0]
    
    checksum = hashlib.md5()
    offset = 0
    
    while offset < total:
        cursor.execute(f"""
            SELECT {','.join(columns)} 
            FROM {table} 
            ORDER BY id 
            LIMIT {batch_size} OFFSET {offset}
        """)
        
        for row in cursor.fetchall():
            # 将行数据转为字符串计算MD5
            row_str = '|'.join(str(c) for c in row)
            checksum.update(row_str.encode())
        
        offset += batch_size
        print(f"进度: {min(offset, total)}/{total}")
    
    return checksum.hexdigest()

# 对比新旧库
old_checksum = compute_checksum(old_conn, 'orders', ['id', 'user_id', 'amount', 'status'])
new_checksum = compute_checksum(new_conn, 'orders', ['id', 'user_id', 'amount', 'status'])

if old_checksum == new_checksum:
    print("✅ 数据一致性校验通过")
else:
    print("❌ 数据不一致，需要排查")
    exit(1)
```

**抽样校验（日常监控）：**

```sql
-- 每日随机抽样1000条对比
SET @sample_size = 1000;

-- 旧库抽样
CREATE TEMPORARY TABLE sample_old AS
SELECT * FROM orders 
ORDER BY RAND() 
LIMIT @sample_size;

-- 新库抽样
CREATE TEMPORARY TABLE sample_new AS
SELECT * FROM new_db.orders 
WHERE id IN (SELECT id FROM sample_old);

-- 对比差异
SELECT COUNT(*) as mismatch_count
FROM sample_old o
LEFT JOIN sample_new n ON o.id = n.id
WHERE o.user_id != n.user_id 
   OR o.amount != n.amount 
   OR o.status != n.status;
```

* * *

### 三、切换流程设计（灰度方案）

#### 3.1 切换阶段划分

```yaml
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: 影子流量验证  (1-3天)                                  │
│  - 生产流量旁路到只读新库                                        │
│  - 对比查询结果，不放流量                                          │
├─────────────────────────────────────────────────────────────────┤
│  Phase 2: 读流量灰度   (3-7天)                                   │
│  - 5% → 20% → 50% → 100% 读流量切新库                           │
│  - 写流量仍走旧库                                                │
├─────────────────────────────────────────────────────────────────┤
│  Phase 3: 双写阶段    (1-3天)                                    │
│  - 写操作同时写入新旧库                                           │
│  - 以旧库为准，新库异步同步                                        │
├─────────────────────────────────────────────────────────────────┤
│  Phase 4: 写流量切换   (1天)                                     │
│  - 切100%写流量到新库                                             │
│  - 旧库保持同步，随时准备回滚                                      │
├─────────────────────────────────────────────────────────────────┤
│  Phase 5: 观察期      (7-14天)                                   │
│  - 新旧库双向同步                                                  │
│  - 确认无问题后下线旧库                                            │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 代码层切换开关

**数据库路由配置：**

```java
@Component
public class DataSourceRouter {
    
    @Value("${db.switch.phase:PHASE1}")
    private SwitchPhase phase;
    
    @Autowired
    private DataSource oldDataSource;
    
    @Autowired
    private DataSource newDataSource;
    
    public DataSource route(OperationType operation) {
        switch (phase) {
            case PHASE1: // 影子验证期
                return oldDataSource;
                
            case PHASE2_READ_GRAY: // 读灰度
                if (operation == OperationType.READ) {
                    // 根据用户ID哈希决定是否走新库
                    return shouldUseNewForRead() ? newDataSource : oldDataSource;
                }
                return oldDataSource;
                
            case PHASE3_DUAL_WRITE: // 双写期
                if (operation == OperationType.WRITE) {
                    // 写操作同时入队列，异步写新库
                    asyncWriteToNew(requestContext.getWriteData());
                }
                return oldDataSource;
                
            case PHASE4_WRITE_NEW: // 写切新库
                return operation == OperationType.WRITE ? newDataSource : oldDataSource;
                
            case PHASE5_FULL_NEW: // 全量新库
                return newDataSource;
                
            default:
                return oldDataSource;
        }
    }
    
    private boolean shouldUseNewForRead() {
        // 灰度比例控制：5% -> 20% -> 50% -> 100%
        int grayPercent = configService.getGrayPercent();
        long userId = RequestContext.getUserId();
        return (userId % 100) < grayPercent;
    }
}
```

**动态配置（Nacos/Apollo）：**

```yaml
# db-switch-config.yaml
db:
  switch:
    phase: PHASE2_READ_GRAY  # 可动态修改
    gray_percent: 20         # 灰度比例
    new_db_read_timeout: 500 # 新库读超时降级阈值
    fallback_enabled: true   # 失败是否回退旧库
```

#### 3.3 流量切换操作手册

**Phase 2 读流量切换（示例）：**

```bash
#!/bin/bash
# gray-switch.sh - 灰度切换脚本

PHASE=$1  # up/down/status
PERCENT=$2

if [ "$PHASE" == "up" ]; then
    # 提升灰度比例
    curl -X POST "http://config-center/api/config" \
      -H "Content-Type: application/json" \
      -d "{
        "appId": "order-service",
        "key": "db.switch.gray_percent",
        "value": "$PERCENT"
      }"
    echo "灰度比例已调整至 ${PERCENT}%"
    
    # 等待配置生效（通常10-30秒）
    sleep 30
    
    # 验证切换效果
    verify_switch
    
elif [ "$PHASE" == "status" ]; then
    # 查看当前状态
    curl "http://order-service/actuator/db-switch"
fi

function verify_switch() {
    # 检查错误率
    ERROR_RATE=$(curl -s "http://monitoring/api/query?metric=db_error_rate" | jq '.value')
    if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
        echo "❌ 错误率过高(${ERROR_RATE})，准备回滚"
        rollback
        exit 1
    fi
    
    # 检查延迟
    P99_LATENCY=$(curl -s "http://monitoring/api/query?metric=db_p99_latency" | jq '.value')
    if (( $(echo "$P99_LATENCY > 100" | bc -l) )); then
        echo "⚠️ 延迟异常(${P99_LATENCY}ms)，持续观察"
    fi
    
    echo "✅ 切换验证通过"
}

function rollback() {
    echo "执行回滚..."
    curl -X POST "http://config-center/api/config" \
      -d '{"key":"db.switch.gray_percent","value":"0"}'
}
```

**切换时间表（建议）：**

| 时间 | 操作 | 负责人 | 验证项 |
| --- | --- | --- | --- |
| 00:00 | 发布公告 | 运维 | - |
| 00:10 | 切5%读流量 | DBA | 错误率<0.1% |
| 00:30 | 观察期 | 值班 | 监控正常 |
| 01:00 | 切20%读流量 | DBA | 错误率<0.1% |
| 02:00 | 切50%读流量 | DBA | P99延迟<50ms |
| 04:00 | 切100%读流量 | DBA | 全量验证 |
| 次日 | 观察24小时 | 值班 | 无异常继续 |

* * *

### 四、风险防控与监控体系

#### 4.1 多层降级策略

```makefile
L1: 新库读失败 → 自动降级到旧库读
L2: 新库写失败 → 记录日志，异步补偿
L3: 新旧库同时故障 → 进入只读模式/服务降级
```

**代码实现：**

```scss
@Service
public class OrderService {
    
    @Autowired
    private OrderRepository newRepo;
    
    @Autowired
    private OrderRepository oldRepo;
    
    @CircuitBreaker(name = "newDbRead", fallbackMethod = "readFromOld")
    public Order getOrder(Long id) {
        return newRepo.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
    }
    
    // 降级方法
    public Order readFromOld(Long id, Exception ex) {
        log.warn("新库读取失败，降级到旧库", ex);
        return oldRepo.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
    }
    
    @Retryable(value = {DataAccessException.class}, maxAttempts = 3)
    @Transactional
    public void createOrder(Order order) {
        try {
            // 优先写新库
            newRepo.save(order);
            // 异步同步到旧库（保证最终一致）
            asyncSyncToOld(order);
        } catch (Exception e) {
            // 新库失败，写旧库保证可用性
            log.error("新库写入失败，写入旧库", e);
            oldRepo.save(order);
            // 标记需要后续同步
            markForSync(order.getId());
        }
    }
}
```

#### 4.2 监控告警体系

**关键指标Dashboard：**

```markdown
监控面板:
  业务指标:
    - QPS（按库分组）
    - 错误率（新旧库对比）
    - 平均响应时间 / P99 / P999
    - 慢查询数量
    
  数据同步指标:
    - 复制延迟（Seconds_Behind_Master）
    - 同步任务堆积数
    - 数据一致性校验结果
    - 冲突/丢数事件数
    
  系统资源:
    - CPU / 内存 / 磁盘IO
    - 连接数 / 活跃线程
    - 锁等待 / 死锁次数
```

**告警规则配置：**

```yaml
# 告警规则
rules:
  - name: 新库错误率过高
    condition: new_db_error_rate > 1%
    duration: 2m
    severity: critical
    action: 电话通知 + 自动降级
    
  - name: 复制延迟过高
    condition: replication_lag > 5s
    duration: 1m
    severity: warning
    action: 钉钉通知
    
  - name: 数据不一致
    condition: checksum_mismatch > 0
    duration: 0s
    severity: critical
    action: 立即暂停切换 + 排查
    
  - name: 新库连接数耗尽
    condition: new_db_connections > 80%
    duration: 30s
    severity: warning
    action: 扩容或限流
```

#### 4.3 实时检测脚本

```python
#!/usr/bin/env python3
"""数据库切换实时监控"""

import time
import pymysql
import requests
from datetime import datetime

class MigrationMonitor:
    def __init__(self):
        self.old_db = pymysql.connect(host='old-master', user='monitor', password='xxx')
        self.new_db = pymysql.connect(host='new-master', user='monitor', password='xxx')
        self.alert_webhook = 'https://oapi.dingtalk.com/robot/send?access_token=xxx'
    
    def check_replication_lag(self):
        """检查复制延迟"""
        cursor = self.new_db.cursor()
        cursor.execute("SHOW SLAVE STATUS")
        result = cursor.fetchone()
        lag = result['Seconds_Behind_Master']
        
        if lag is None:
            self.alert("复制已停止！", "critical")
        elif lag > 10:
            self.alert(f"复制延迟过高: {lag}秒", "warning")
        
        return lag
    
    def check_data_consistency(self, sample_size=1000):
        """抽样数据一致性检查"""
        cursor = self.old_db.cursor()
        cursor.execute(f"""
            SELECT id, MD5(CONCAT(user_id, amount, status)) as checksum
            FROM orders
            ORDER BY RAND()
            LIMIT {sample_size}
        """)
        old_samples = {row['id']: row['checksum'] for row in cursor.fetchall()}
        
        cursor.execute(f"""
            SELECT id, MD5(CONCAT(user_id, amount, status)) as checksum
            FROM orders
            WHERE id IN ({','.join(map(str, old_samples.keys()))})
        """)
        new_samples = {row['id']: row['checksum'] for row in cursor.fetchall()}
        
        mismatches = [id for id, checksum in old_samples.items() 
                     if new_samples.get(id) != checksum]
        
        if mismatches:
            self.alert(f"发现 {len(mismatches)} 条数据不一致", "critical")
        
        return len(mismatches)
    
    def check_error_rate(self):
        """通过业务指标检查错误率"""
        # 从监控系统查询
        response = requests.get('http://prometheus/api/query', params={
            'query': 'rate(http_requests_total{status=~"5.."}[5m])'
        })
        error_rate = response.json()['data']['result'][0]['value'][1]
        
        if float(error_rate) > 0.01:
            self.alert(f"错误率过高: {error_rate}", "critical")
        
        return error_rate
    
    def alert(self, message, level):
        """发送告警"""
        payload = {
            "msgtype": "markdown",
            "markdown": {
                "title": f"【{level.upper()}】数据库切换告警",
                "text": f"### 告警时间: {datetime.now()}\n{message}"
            }
        }
        requests.post(self.alert_webhook, json=payload)
    
    def run(self):
        """持续监控"""
        while True:
            try:
                print(f"[{datetime.now()}] 开始监控检查...")
                self.check_replication_lag()
                self.check_data_consistency()
                self.check_error_rate()
                print("检查完成，等待60秒...")
            except Exception as e:
                self.alert(f"监控异常: {str(e)}", "critical")
            
            time.sleep(60)

if __name__ == '__main__':
    monitor = MigrationMonitor()
    monitor.run()
```

* * *

### 五、回滚方案（救命稻草）

#### 5.1 分级回滚策略

```
Level 1 - 配置回滚（秒级）
  └─ 切回旧库读取，修改配置中心开关

Level 2 - 流量切回（分钟级）
  └─ 全部流量回切旧库，新库作为备库

Level 3 - 数据修复（小时级）
  └─ 新库数据回刷旧库，修复不一致

Level 4 - 全量重建（天级）
  └─ 极端情况，从备份恢复
```

#### 5.2 一键回滚脚本

```bash
#!/bin/bash
# emergency-rollback.sh - 紧急回滚脚本

set -e

ROLLBACK_LEVEL=$1
BACKUP_TIME=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/var/log/rollback_${BACKUP_TIME}.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

# Level 1: 配置回滚
level1_rollback() {
    log "执行 Level 1 回滚 - 配置切换..."
    
    # 关闭新库流量
    curl -X POST "http://config-center/api/config" \
      -d '{
        "appId": "all-services",
        "key": "db.switch.phase",
        "value": "PHASE0_OLD_ONLY"
      }'
    
    # 等待配置生效
    sleep 30
    
    # 验证回滚
    NEW_DB_QPS=$(curl -s "http://monitoring/api/query?metric=new_db_qps" | jq '.value')
    if [ "$NEW_DB_QPS" -eq 0 ]; then
        log "✅ Level 1 回滚成功，新库流量已清零"
    else
        log "❌ Level 1 回滚失败，新库仍有流量: $NEW_DB_QPS"
        exit 1
    fi
}

# Level 2: 流量完全切回
level2_rollback() {
    level1_rollback
    
    log "执行 Level 2 回滚 - 流量全切旧库..."
    
    # 检查旧库健康状态
    OLD_DB_STATUS=$(mysql -h old-master -e "SELECT 1" 2>/dev/null && echo "healthy" || echo "unhealthy")
    if [ "$OLD_DB_STATUS" != "healthy" ]; then
        log "❌ 旧库不可用，无法执行Level 2回滚！"
        exit 1
    fi
    
    # 强制所有服务重连旧库
    for service in order-service user-service payment-service; do
        curl -X POST "http://$service/actuator/refresh"
        log "已刷新 $service 配置"
    done
    
    log "✅ Level 2 回滚完成"
}

# Level 3: 数据修复回滚
level3_rollback() {
    level2_rollback
    
    log "执行 Level 3 回滚 - 数据修复..."
    
    # 生成差异数据报告
    mysql -h old-master -e "
        SELECT '新库有旧库无' as diff_type, n.id 
        FROM new_db.orders n 
        LEFT JOIN orders o ON n.id = o.id 
        WHERE o.id IS NULL
        UNION
        SELECT '数据不一致' as diff_type, o.id
        FROM orders o
        JOIN new_db.orders n ON o.id = n.id
        WHERE o.updated_at != n.updated_at
    " > /tmp/data_diff_report.txt
    
    DIFF_COUNT=$(wc -l < /tmp/data_diff_report.txt)
    log "发现 $DIFF_COUNT 条差异数据"
    
    # 反向同步：新库 -> 旧库
    mysql -h new-master -e "
        SET SESSION sql_log_bin = 0;
        INSERT INTO old_db.orders 
        SELECT * FROM orders 
        WHERE id IN (SELECT id FROM /tmp/data_diff_report.txt)
        ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        amount = VALUES(amount),
        status = VALUES(status),
        updated_at = VALUES(updated_at);
    "
    
    log "✅ Level 3 回滚完成，数据已同步"
}

# 执行回滚
case $ROLLBACK_LEVEL in
    1) level1_rollback ;;
    2) level2_rollback ;;
    3) level3_rollback ;;
    *) echo "用法: $0 <1|2|3>" ; exit 1 ;;
esac

log "回滚执行完毕，日志保存至: $LOG_FILE"
```

#### 5.3 回滚决策流程

```scss
发现异常
    │
    ├─ 新库错误率 > 1% ? ──Yes──> 立即 Level 1 回滚
    │                             (30秒内完成)
    │
    ├─ 数据不一致 ? ──────Yes──> 暂停切换 + Level 3 回滚
    │                             (修复后重新校验)
    │
    ├─ 新库完全不可用 ? ──Yes──> Level 2 回滚
    │                             (切回旧库全量)
    │
    └─ 旧库也不可用 ? ────Yes──> 启动灾备预案
                                  (从异地备份恢复)
```

* * *

### 六、数据零丢失保障

#### 6.1 多重备份策略

```lua
┌─────────────────────────────────────────────────────┐
│  实时层: Binlog实时归档 (保存30天)                      │
│  └─ 工具: canal + Kafka + S3                         │
├─────────────────────────────────────────────────────┤
│  小时层: 每小时增量备份                                 │
│  └─ 工具: mydumper / xtrabackup --incremental         │
├─────────────────────────────────────────────────────┤
│  日级层: 每日全量备份                                   │
│  └─ 工具: xtrabackup + 压缩存储到OSS                   │
├─────────────────────────────────────────────────────┤
│  冷备层: 跨地域副本                                     │
│  └─ 异地机房或云存储                                   │
└─────────────────────────────────────────────────────┘
```

#### 6.2 数据防丢检查清单

迁移前必须确认：

```ini
□ binlog_format = ROW 且已开启
□ binlog保留时间 >= 7天
□ 全量备份已验证可恢复
□ 增量备份脚本已测试
□ 异地备份已同步
□ 数据校验脚本通过
□ 回滚数据同步链路已就绪
```

#### 6.3 极端情况数据恢复

**场景：切换过程中双库同时故障**

```bash
#!/bin/bash
# disaster-recovery.sh - 灾难恢复

# 1. 确定恢复时间点（通常选择切换前最后一次校验通过的点）
RECOVERY_TIME="2024-01-15 03:00:00"

# 2. 从冷备恢复基础数据
aws s3 cp s3://backup-bucket/full-backup-20240115.gz /restore/
gunzip /restore/full-backup-20240115.gz

# 3. 应用增量备份
for incr in /backup/incremental/20240115_*.xbstream; do
    xbstream -x < $incr -C /restore/incremental/
    xtrabackup --apply-log-only /restore --incremental-dir=/restore/incremental/
done

# 4. 应用binlog到指定时间点
mysqlbinlog \
    --start-datetime="$RECOVERY_TIME" \
    --stop-datetime="2024-01-15 05:00:00" \
    /backup/binlog/mysql-bin.000* | mysql -h recovery-host

# 5. 数据校验
./verify_checksum.sh

# 6. 对外服务
systemctl start mysql-recovery
```

* * *

### 七、完整切换检查清单

#### 7.1 准备阶段

-   数据规模评估完成
-   迁移方案评审通过
-   新库环境搭建完成
-   同步链路测试通过
-   数据一致性校验通过
-   回滚方案演练通过
-   监控告警配置完成
-   值班人员安排到位
-   业务方通知已发送

#### 7.2 切换阶段

-   影子流量验证无异常（1-3天）
-   5%读流量切换成功，观察30分钟
-   20%读流量切换成功，观察2小时
-   50%读流量切换成功，观察4小时
-   100%读流量切换成功，观察24小时
-   双写开启，数据实时校验无差异
-   写流量切换成功，观察48小时
-   全量业务验证通过

#### 7.3 收尾阶段

-   旧库保持同步7-14天无异常
-   性能对比报告输出
-   文档更新完成
-   旧库资源释放

* * *

### 结语

数据库切换的核心原则：

1.  **宁可慢，不可错** — 每个阶段都要充分验证
2.  **随时能回** — 每一步都要有回滚能力
3.  **数据第一** — 宁可停机，不可丢数
4.  **自动化** — 把人手操作减到最少

最可靠的迁移策略永远是：**小步快跑，灰度验证，随时回滚。**

* * *

### 八、代码层适配改造指南

#### 8.1 存量服务改造成本评估

在动手之前，先评估代码改造的范围：

```bash
#!/bin/bash
# analyze_db_dependencies.sh - 分析数据库依赖

# 1. 统计涉及数据库的代码文件
grep -rn "jdbc|mysql|oracle|postgres|hikari|datasource" \
    --include="*.java" \
    --include="*.py" \
    --include="*.go" \
    src/ > db_dependencies.txt

# 2. 统计原生SQL使用情况
grep -rn "@Query|JDBC|Statement|PreparedStatement" \
    --include="*.java" src/ > native_sql.txt

# 3. 统计存储过程/函数调用
grep -rn "CALL|EXEC|procedure|function" \
    --include="*.sql" sql/ > stored_procs.txt

# 4. 生成改造工作量预估
echo "=== 改造工作量预估 ==="
echo "数据源配置文件: $(grep -l 'jdbc|datasource' src/*.yaml | wc -l) 个"
echo "原生SQL文件: $(wc -l < native_sql.txt) 处"
echo "存储过程: $(wc -l < stored_procs.txt) 个"
```

**改造工作量分级：**

| 等级 | 特征 | 预估工作量 |
| --- | --- | --- |
| ⭐ 简单 | 仅需改配置，无需改代码 | 1-2天 |
| ⭐⭐ 中等 | 少量SQL语法调整 | 1周 |
| ⭐⭐⭐ 复杂 | 大量原生SQL + 存储过程 | 2-4周 |
| ⭐⭐⭐⭐ 极复杂 | 跨库JOIN + 事务依赖 | 需重构 |

#### 8.2 常见数据库语法差异与适配

**MySQL** **→** **PostgreSQL** **常见差异：**

```sql
// ❌ MySQL 语法
SELECT * FROM orders 
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
LIMIT 10 OFFSET 20;

// ✅ PostgreSQL 语法
SELECT * FROM orders 
WHERE created_at >= NOW() - INTERVAL '7 days'
LIMIT 10 OFFSET 20;

// ========== 类型差异 ==========

// MySQL 自增主键
CREATE TABLE user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50)
);

// PostgreSQL 序列
CREATE TABLE user (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50)
);

// ========== 分页差异 ==========

// MySQL: LIMIT offset, count
SELECT * FROM orders LIMIT 20, 10;

// PostgreSQL: LIMIT count OFFSET offset  
SELECT * FROM orders LIMIT 10 OFFSET 20;

// ========== 字符串拼接差异 ==========

// MySQL: CONCAT 或 ||
SELECT CONCAT(name, '_', id) FROM user;

// PostgreSQL: 推荐使用 ||
SELECT name || '_' || id FROM user;
-- 或使用 CONCAT (也支持)
SELECT CONCAT(name, '_', id) FROM user;
```

**自动化转换工具：**

```python
# mysql_to_pg_converter.py

class MySQLToPostgreSQLConverter:
    def __init__(self):
        self.replacements = {
            # 类型映射
            r'AUTO_INCREMENT': 'BIGSERIAL',
            r'INT((\d+)) UNSIGNED': 'INT',  # 注意范围
            r'TINYINT(1)': 'BOOLEAN',
            r'DATETIME': 'TIMESTAMP',
            r'BLOB': 'BYTEA',
            r'TEXT': 'TEXT',
            
            # 语法转换
            r'DATE_SUB((.*?), INTERVAL (\d+) DAY)': r"\1 - INTERVAL '\2 days'",
            r'NOW()': 'NOW()',
            r'LIMIT (\d+), (\d+)': r"LIMIT \2 OFFSET \1",
            r'IFNULL((.*?), (.*?))': r"COALESCE(\1, \2)",
            r'GROUP_CONCAT((.*?))': r"STRING_AGG(\1, ',')",
            
            # 函数映射
            r'FIND_IN_SET((.*?), (.*?))': r"(STRING_TO_ARRAY(\2, ',') @> ARRAY[\1])",
        }
    
    def convert(self, sql):
        import re
        result = sql
        for pattern, replacement in self.replacements.items():
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
        return result

# 使用示例
converter = MySQLToPostgreSQLConverter()
converted_sql = converter.convert(original_mysql_sql)
```

#### 8.3 代码层适配策略

**策略A：配置化切换（推荐）**

适用于：SQL语法差异小、可通过配置屏蔽

```typescript
// 1. 创建数据库抽象层
public interface DatabaseAdapter {
    String getPaginateSql(String sql, int offset, int limit);
    String getDateSubSql(String dateExpr, int days);
    String getIfNullSql(String expr, String defaultValue);
    String getConcatSql(String... exprs);
    ...
}

// 2. MySQL 实现
@Component
public class MySQLAdapter implements DatabaseAdapter {
    @Override
    public String getPaginateSql(String sql, int offset, int limit) {
        return sql + " LIMIT " + offset + ", " + limit;
    }
    
    @Override
    public String getDateSubSql(String dateExpr, int days) {
        return "DATE_SUB(" + dateExpr + ", INTERVAL " + days + " DAY)";
    }
}

// 3. PostgreSQL 实现
@Component  
public class PostgreSQLAdapter implements DatabaseAdapter {
    @Override
    public String getPaginateSql(String sql, int offset, int limit) {
        return sql + " LIMIT " + limit + " OFFSET " + offset;
    }
    
    @Override
    public String getDateSubSql(String dateExpr, int days) {
        return dateExpr + " - INTERVAL '" + days + " days'";
    }
}

// 4. 根据配置动态选择
@Configuration
public class AdapterConfig {
    @Value("${database.type:mysql}")
    private String databaseType;
    
    @Bean
    public DatabaseAdapter databaseAdapter() {
        return switch (databaseType.toLowerCase()) {
            case "postgresql", "pg" -> new PostgreSQLAdapter();
            default -> new MySQLAdapter();
        };
    }
}
```

**策略B：中间件透明切换**

适用于：不想改代码，用 Proxy 屏蔽底层差异

```yaml
# ShardingSphere-Proxy 配置示例
schemaName: sharding_db

dataSources:
  ds_0:
    url: jdbc:mysql://old-master:3306/orders?useSSL=false
    username: root
    password: 
  ds_1:
    url: jdbc:mysql://new-pg:5432/orders?useSSL=false
    username: postgres
    password: 

# 读写分离
readWriteSplitting:
  name: read_write_splitting
  readDataSourceNames:
    - ds_1
  writeDataSourceName: ds_0
  
  loadBalancers:
    round_robin:
      type: ROUND_ROBIN
```

**策略C：全链路迁移（彻底方案）**

适用于：异构严重，需要全新实现

```less
// 新项目直接使用
// 1. 选择兼容两端的最小公约数
// 2. 使用 JPA/Hibernate 抽象层
// 3. 避免使用数据库特有功能

@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    // ⚠️ 注意：不同数据库对 IDENTITY 支持不同
    // PostgreSQL: 用 SEQUENCE 更好
    // 建议统一用 TABLE 或 SEQUENCE
    private Long id;
    
    @Column(columnDefinition = "VARCHAR(50)")
    private String status;
    
    @Column(columnDefinition = "TIMESTAMP")
    private Instant createdAt;
}
```

#### 8.4 新应用数据库选型与适配

**选型** **决策树** **：**

```scss
业务场景
    │
    ├─ 事务强一致 + 低延迟 + 高并发
    │   └─ MySQL 8.0 / PostgreSQL 15 + Redis 缓存
    │
    ├─ 海量数据 + 分布式 + 弹性扩展
    │   └─ TiDB / OceanBase / CockroachDB
    │
    ├─ 复杂查询 + 统计分析
    │   └─ MySQL(OLTP) + ClickHouse(OLAP) 分离
    │
    ├─ 文档/JSON 为主
    │   └─ MongoDB / PostgreSQL JSONB
    │
    └─ 全文搜索为主
        └─ Elasticsearch + MySQL 组合
```

**新应用代码规范：**

```csharp
// ✅ 推荐：Repository 抽象
public interface OrderRepository extends JpaRepository<Order, Long> {
    // 避免硬编码 SQL，充分利用 JPA 抽象
    List<Order> findByUserIdAndStatus(Long userId, String status);
    
    // 复杂查询用 @Query，但指定 nativeQuery = false
    @Query("SELECT o FROM Order o WHERE o.createdAt >= :startDate")
    List<Order> findRecentOrders(@Param("startDate") Instant startDate);
}

// ✅ 推荐：使用 Specification 进行动态查询
public Specification<Order> buildSpecification(OrderSearchVO params) {
    return (root, query, cb) -> {
        List<Predicate> predicates = new ArrayList<>();
        
        if (params.getUserId() != null) {
            predicates.add(cb.equal(root.get("userId"), params.getUserId()));
        }
        if (params.getStatus() != null) {
            predicates.add(cb.equal(root.get("status"), params.getStatus()));
        }
        // ... 更多条件
        
        return cb.and(predicates.toArray(new Predicate[0]));
    };
}

// ✅ 推荐：事务边界清晰
@Service
public class OrderService {
    
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void createOrder(OrderDTO dto) {
        // 一个事务内只操作一个数据库
        // 跨服务调用用消息队列
    }
}
```

**数据库无关的** **SQL** **编写原则：**

```sql
-- ✅ 安全写法：避免数据库特有功能
SELECT id, user_id, amount, status, created_at 
FROM orders 
WHERE user_id = ?
  AND status = 'PENDING'
ORDER BY created_at DESC
LIMIT 100;

-- ❌ 危险写法：依赖特定数据库
SELECT * FROM orders 
WHERE DATE(created_at) = DATE(NOW())  -- MySQL 语法
LIMIT 1000000;  -- 大LIMIT可能导致内存问题

-- ✅ 安全写法
SELECT id, user_id, amount, status, created_at 
FROM orders 
WHERE created_at >= ? AND created_at < ?
  AND status = 'PENDING'
LIMIT 100;
```

#### 8.5 代码改造检查清单

```makefile
改造前检查:
  □ 统计所有数据库配置文件
  □ 列出所有原生SQL语句
  □ 识别所有存储过程和函数
  □ 识别所有数据库特有语法
  □ 评估ORM框架覆盖率

改造中:
  □ 配置化切换开关已实现
  □ 降级逻辑已实现
  □ 事务边界已梳理
  □ 日志已增强（方便排查）

改造后验证:
  □ 单元测试全部通过
  □ 集成测试覆盖核心流程
  □ 性能测试无明显退化
  □ 监控指标已配置
```

* * *

### 九、总结与建议

#### 9.1 核心原则

1.  **存量服务：稳字当头**
    
    1.  优先用中间件透明切换
    2.  灰度验证每一步
    3.  随时保留回滚能力
2.  **新服务：面向未来**
    
    1.  选择主流开源数据库
    2.  代码层做好抽象
    3.  避免数据库锁定
3.  **数据：宁停不丢**
    
    1.  多重备份策略
    2.  实时监控校验
    3.  回滚方案就绪

#### 9.2 行动建议

| 时间 | 动作 |
| --- | --- |
| 第1周 | 完成现状评估 + 方案设计 |
| 第2-3周 | 搭建新环境 + 同步链路 |
| 第4周 | 影子验证 + 问题修复 |
| 第5-6周 | 读流量灰度切换 |
| 第7-8周 | 双写 + 写流量切换 |
| 第3个月 | 观察期结束，下线旧库 |
