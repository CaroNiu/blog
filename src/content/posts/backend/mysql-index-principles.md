---
title: "MySQL 索引原理：面试官最爱问的 5 个问题"
pubDate: 2026-03-14
category: backend
tags: []
summary: "前言 MySQL 索引是后端面试的高频考点，也是实际工作中影响系统性能的关键因素。 这篇文章整理了面试官最爱问的 5 个索引问题，带你从原理到实战全面掌握。 问题一：索引是什么？为什么要用索引？ 什么"
draft: false
juejin:
  id: "7616631448961744950"
  url: https://juejin.cn/post/7616631448961744950
  views: 164
  likes: 0

---
## 前言

MySQL 索引是后端面试的高频考点，也是实际工作中影响系统性能的关键因素。

这篇文章整理了面试官最爱问的 5 个索引问题，带你从原理到实战全面掌握。

* * *

## 问题一：索引是什么？为什么要用索引？

### 什么是索引？

打个比方：索引就像书的目录。

没有目录，你要找某个知识点，只能从第一页翻到最后一页（**全表扫描**）。

有了目录，你可以直接定位到页码（**索引查找**）。

### 索引的作用

| 优势 | 劣势 |
| --- | --- |
| 大幅提高查询速度 | 占用额外存储空间 |
| 加速 ORDER BY 和 GROUP BY | 降低写操作速度（需维护索引） |
| 唯一索引保证数据唯一性 | 建得太多反而适得其反 |

### MySQL 索引的数据结构

MySQL 的 InnoDB 引擎使用 **B+ 树** 作为索引结构。

**为什么是 B+ 树而不是 B 树？**

1.  **B+ 树所有数据都在** **叶子节点**，查询效率更稳定
2.  **叶子节点** **用指针连接**，范围查询更快
3.  **非** **叶子节点** **只存键值**，一页能存更多索引项，树更矮

```css
                    [20, 50]
                   /    |    \
          [10, 15]  [30, 40]  [60, 70]
             |         |         |
         [10→15→20→30→40→50→60→70]  ← 叶子节点链表
```

* * *

## 问题二：聚簇索引和非聚簇索引有什么区别？

这是索引原理的核心问题！

### 聚簇索引（Clustered Index）

**聚簇索引** **\= 索引 + 数据 在一起**

-   InnoDB 的主键就是聚簇索引
-   叶子节点直接存储整行数据
-   一张表只能有一个聚簇索引

```bash
聚簇索引结构：
主键值 → 完整行数据

例如：id=1 → {id:1, name:'阿牛', age:25, ...}
```

### 非聚簇索引（Secondary Index）

**非聚簇索引** **\= 索引 +** **主键** **值**

-   除主键外的其他索引都是非聚簇索引
-   叶子节点存储的是主键值
-   查询需要「回表」才能获取完整数据

```ini
非聚簇索引结构：
索引列值 → 主键值

例如：name 索引 → name='阿牛' → id=1
然后通过 id=1 去聚簇索引查完整数据（回表）
```

### 回表是什么？

当你通过非主键索引查询时：

```sql
-- 假设有索引 idx_name(name)
SELECT * FROM user WHERE name = '阿牛';
```

执行过程：

1.  在 `idx_name` 索引树找到 `name='阿牛'`，得到主键 `id=1`
2.  用 `id=1` 去聚簇索引查找完整数据

这就是 **回表**，需要两次 B+ 树查找。

### 如何避免回表？

**覆盖索引**：查询的列都在索引中，不需要回表。

```sql
-- 如果有联合索引 idx_name_age(name, age)
SELECT name, age FROM user WHERE name = '阿牛';
-- 直接从索引获取 name 和 age，无需回表！
```

* * *

## 问题三：什么情况下索引会失效？

这是面试必问！记住以下场景：

### 1\. 对索引列进行函数操作

```sql
-- ❌ 索引失效
SELECT * FROM user WHERE YEAR(create_time) = 2024;

-- ✅ 正确写法
SELECT * FROM user WHERE create_time >= '2024-01-01' 
                      AND create_time < '2025-01-01';
```

### 2\. 隐式类型转换

```sql
-- 假设 phone 是 varchar 类型，有索引
-- ❌ 索引失效（数字和字符串比较，发生隐式转换）
SELECT * FROM user WHERE phone = 13800138000;

-- ✅ 正确写法
SELECT * FROM user WHERE phone = '13800138000';
```

### 3\. LIKE 以 % 开头

```sql
-- ❌ 索引失效
SELECT * FROM user WHERE name LIKE '%牛%';

-- ✅ 可以走索引
SELECT * FROM user WHERE name LIKE '牛%';
```

### 4\. OR 条件中有非索引列

```sql
-- 假设只有 name 有索引
-- ❌ 索引失效
SELECT * FROM user WHERE name = '阿牛' OR age = 25;

-- ✅ 改成 UNION
SELECT * FROM user WHERE name = '阿牛'
UNION
SELECT * FROM user WHERE age = 25;
```

### 5\. 联合索引不满足最左匹配

```css
-- 假设有联合索引 idx_a_b_c(a, b, c)

-- ✅ 走索引
WHERE a = 1
WHERE a = 1 AND b = 2
WHERE a = 1 AND b = 2 AND c = 3

-- ❌ 不走索引（跳过了 a）
WHERE b = 2 AND c = 3

-- ❌ 不走索引（跳过了 b）
WHERE a = 1 AND c = 3
```

### 6\. != 或 <> 或 NOT IN

```sql
-- ❌ 索引可能失效
SELECT * FROM user WHERE status != 1;

-- ✅ 改成 IN 或范围查询
SELECT * FROM user WHERE status IN (0, 2, 3);
```

* * *

## 问题四：联合索引的设计原则是什么？

### 最左匹配原则

联合索引按照定义顺序生效，必须从最左列开始匹配。

```css
-- 索引：idx_a_b_c(a, b, c)

-- 可以匹配的组合：
✅ a
✅ a, b
✅ a, b, c
✅ a, c（只有 a 生效，c 用于索引下推）

-- 不能匹配的组合：
❌ b
❌ c
❌ b, c
```

### 联合索引设计技巧

**原则 1：区分度高的列放前面**

```scss
-- 区分度公式：COUNT(DISTINCT column) / COUNT(*)

-- 假设 status 只有 0/1，而 name 各不相同
-- 应该把 name 放前面
CREATE INDEX idx_name_status ON user(name, status);
```

**原则 2：覆盖常用查询**

```sql
-- 如果经常查询：
SELECT name, age FROM user WHERE name = '阿牛';

-- 建立联合索引
CREATE INDEX idx_name_age ON user(name, age);
-- 走覆盖索引，无需回表
```

**原则 3：考虑排序**

```sql
-- 如果经常按 name 查询并按 age 排序
SELECT * FROM user WHERE name = '阿牛' ORDER BY age;

-- 索引顺序应该是
CREATE INDEX idx_name_age ON user(name, age);
-- 索引本身有序，避免 filesort
```

* * *

## 问题五：如何分析和优化索引？

### 使用 EXPLAIN 分析

```sql
EXPLAIN SELECT * FROM user WHERE name = '阿牛';
```

重点关注字段：

| 字段 | 含义 | 关注值 |
| --- | --- | --- |
| type | 访问类型 | system > const > eq_ref > ref > range > index > ALL |
| key | 使用的索引 | 看是否走了期望的索引 |
| rows | 预估扫描行数 | 越少越好 |
| Extra | 额外信息 | Using index（覆盖索引）是好事；Using filesort 需优化 |

**type 从好到差**：

```sql
system → const → eq_ref → ref → range → index → ALL
  最好                                           最差
```

### 常见优化场景

**场景 1：慢查询优化**

```sql
-- 发现慢查询
SELECT * FROM orders WHERE user_id = 123 AND status = 1;

-- 分析
EXPLAIN SELECT * FROM orders WHERE user_id = 123 AND status = 1;
-- 发现 type=ALL，全表扫描

-- 优化：添加联合索引
CREATE INDEX idx_user_status ON orders(user_id, status);

-- 再次分析
EXPLAIN SELECT * FROM orders WHERE user_id = 123 AND status = 1;
-- type=ref，走了索引
```

**场景 2：避免重复索引**

```css
-- ❌ 冗余索引
INDEX idx_a (a)
INDEX idx_a_b (a, b)  -- idx_a 是多余的

-- ✅ 只保留
INDEX idx_a_b (a, b)
```

### 索引维护

```sql
-- 查看表索引
SHOW INDEX FROM user;

-- 分析索引使用情况
SELECT * FROM sys.schema_unused_indexes;

-- 重建索引（解决索引碎片）
ALTER TABLE user ENGINE=InnoDB;
```

* * *

## 总结

这篇文章解答了 5 个索引核心问题：

✅ **索引原理**：B+ 树结构，聚簇索引 vs 非聚簇索引 ✅ **索引失效场景**：函数、隐式转换、LIKE %开头、OR、跳过最左列 ✅ **联合索引设计**：最左匹配、区分度、覆盖索引 ✅ **索引优化方法**：EXPLAIN 分析、type 判断、rows 关注

### 面试回答模板

> "MySQL InnoDB 使用 B+ 树作为索引结构。聚簇索引的叶子节点存储完整数据，非聚簇索引存储主键值需要回表。设计索引要考虑区分度、覆盖查询、避免索引失效场景。可以通过 EXPLAIN 分析执行计划，关注 type 和 rows 字段。"

* * *

## 扩展阅读

-   📚 [MySQL 官方文档 - 索引](https://link.juejin.cn?target=https%3A%2F%2Fdev.mysql.com%2Fdoc%2Frefman%2F8.0%2Fen%2Fmysql-indexes.html "https://dev.mysql.com/doc/refman/8.0/en/mysql-indexes.html")
-   📚 《高性能 MySQL》第三版
-   📚 [MySQL 技术内幕：InnoDB 存储引擎](https://link.juejin.cn?target=https%3A%2F%2Fbook.douban.com%2Fsubject%2F24708143%2F "https://book.douban.com/subject/24708143/")

* * *

> 💡 **面试锦囊**：索引是后端面试必考题，建议结合实际项目经验回答，比如"我们之前有个查询慢的问题，通过添加联合索引从 2 秒优化到 20 毫秒"。

> 下一期：《Redis 缓存穿透、击穿、雪崩：一次讲清楚》，敬请期待
