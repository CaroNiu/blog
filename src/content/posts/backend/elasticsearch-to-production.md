---
title: "Elasticsearch 实战指南：从入门到生产"
pubDate: 2026-03-30
category: backend
tags: []
summary: "Elasticsearch 实战指南：从入门到生产 ES 不是只有搜索那么简单。用好它，日志分析、指标监控、推荐系统都能搞定。用不好，集群黄了、查询慢了、数据丢了，全是坑。 这篇文章总结了我在多个项目"
draft: false
juejin:
  id: "7622069365057011754"
  url: https://juejin.cn/post/7622069365057011754
  views: 199
  likes: 3

---
## Elasticsearch 实战指南：从入门到生产

ES 不是只有搜索那么简单。用好它，日志分析、指标监控、推荐系统都能搞定。用不好，集群黄了、查询慢了、数据丢了，全是坑。

这篇文章总结了我在多个项目里踩过的坑和验证过的做法。

* * *

### 一、基础使用

#### 1.1 核心概念（别搞混）

-   **Index**：数据集合，类似数据库的表（MySQL 的 table）
-   **Document**：一条数据记录（MySQL 的一行）
-   **Mapping**：字段类型定义（表结构）
-   **Shard**：数据分片（数据分区）
-   **Replica**：副本分片（主从备份）

**关键理解**：Index 是逻辑概念，Shard 是物理概念。一个 Index 默认 1 个主分片 + 1 个副本分片。

#### 1.2 快速启动（Docker 版）

```bash
# 单节点开发环境
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0

# 验证启动
curl http://localhost:9200
```

#### 1.3 基础 CRUD

**创建索引（显式定义 mapping）：**

```vbnet
curl -X PUT "localhost:9200/products" -H 'Content-Type: application/json' -d'{
  "mappings": {
    "properties": {
      "name": { "type": "text", "analyzer": "ik_max_word" },
      "price": { "type": "float" },
      "category": { "type": "keyword" },
      "created_at": { "type": "date" }
    }
  },
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  }
}'
```

**插入文档：**

```vbnet
curl -X POST "localhost:9200/products/_doc" -H 'Content-Type: application/json' -d'{
  "name": "iPhone 15 Pro",
  "price": 7999.00,
  "category": "手机",
  "created_at": "2024-01-15"
}'
```

**搜索：**

```vbnet
curl -X GET "localhost:9200/products/_search" -H 'Content-Type: application/json' -d'{
  "query": {
    "match": { "name": "iPhone" }
  },
  "sort": [
    { "price": "asc" }
  ]
}'
```

#### 1.4 常用查询类型

**全文搜索（分词匹配）：**

```json
{
  "query": { "match": { "title": "机器学习" }}
}
```

**精确匹配（不分词）：**

```json
{
  "query": { "term": { "status": "published" }}
}
```

**范围查询：**

```json
{
  "query": {
    "range": {
      "price": { "gte": 100, "lte": 500 }
    }
  }
}
```

**多条件组合：**

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "教程" }},
        { "range": { "price": { "lte": 100 }}}
      ],
      "must_not": [
        { "term": { "status": "deleted" }}
      ]
    }
  }
}
```

**聚合统计：**

```json
{
  "aggs": {
    "by_category": {
      "terms": { "field": "category" }
    },
    "avg_price": {
      "avg": { "field": "price" }
    }
  }
}
```

* * *

### 二、实际接入项目（Java 版）

#### 2.1 项目结构（以电商搜索为例）

```bash
project/
├── src/main/java/com/example/es/
│   ├── config/
│   │   └── ElasticsearchConfig.java     # ES 连接配置
│   ├── model/
│   │   └── ProductDocument.java         # 文档实体类
│   ├── repository/
│   │   └── ProductRepository.java       # 数据访问层
│   ├── service/
│   │   ├── ProductIndexer.java          # 数据同步服务
│   │   └── ProductSearchService.java    # 搜索业务逻辑
│   └── controller/
│       └── SearchController.java        # API 接口
└── src/main/resources/
    └── application.yml
```

#### 2.2 Maven 依赖

```xml
<dependencies>
    <!-- Elasticsearch Java API Client -->
    <dependency>
        <groupId>co.elastic.clients</groupId>
        <artifactId>elasticsearch-java</artifactId>
        <version>8.11.0</version>
    </dependency>
    
    <!-- Jackson JSON 处理器 -->
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>2.15.2</version>
    </dependency>
    
    <!-- Jakarta JSON API -->
    <dependency>
        <groupId>jakarta.json</groupId>
        <artifactId>jakarta.json-api</artifactId>
        <version>2.1.2</version>
    </dependency>
</dependencies>
```

#### 2.3 配置类

**application.yml：**

```yaml
elasticsearch:
  host: localhost
  port: 9200
  username: ""       # 如有认证
  password: ""
  connection-timeout: 5000
  socket-timeout: 30000
```

**ElasticsearchConfig.java：**

```kotlin
package com.example.es.config;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.json.jackson.JacksonJsonpMapper;
import co.elastic.clients.transport.ElasticsearchTransport;
import co.elastic.clients.transport.rest_client.RestClientTransport;
import org.apache.http.HttpHost;
import org.apache.http.auth.AuthScope;
import org.apache.http.auth.UsernamePasswordCredentials;
import org.apache.http.client.CredentialsProvider;
import org.apache.http.impl.client.BasicCredentialsProvider;
import org.elasticsearch.client.RestClient;
import org.elasticsearch.client.RestClientBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ElasticsearchConfig {

    @Value("${elasticsearch.host:localhost}")
    private String host;

    @Value("${elasticsearch.port:9200}")
    private int port;

    @Value("${elasticsearch.username:}")
    private String username;

    @Value("${elasticsearch.password:}")
    private String password;

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        RestClientBuilder builder = RestClient.builder(
            new HttpHost(host, port)
        );

        // 配置认证（如有）
        if (!username.isEmpty()) {
            CredentialsProvider credentialsProvider = new BasicCredentialsProvider();
            credentialsProvider.setCredentials(AuthScope.ANY,
                new UsernamePasswordCredentials(username, password));
            builder.setHttpClientConfigCallback(httpClientBuilder ->
                httpClientBuilder.setDefaultCredentialsProvider(credentialsProvider)
            );
        }

        ElasticsearchTransport transport = new RestClientTransport(
            builder.build(), new JacksonJsonpMapper()
        );

        return new ElasticsearchClient(transport);
    }
}
```

#### 2.4 文档实体类

**ProductDocument.java：**

```typescript
package com.example.es.model;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;

public class ProductDocument {
    
    private String skuId;
    private String name;
    private String categoryPath;
    private Float price;
    private Integer stock;
    private Integer salesCount;
    private String shopId;
    private String shopName;
    private Object attributes;
    
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime createdAt;

    // Getters and Setters
    public String getSkuId() { return skuId; }
    public void setSkuId(String skuId) { this.skuId = skuId; }
    
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    
    public String getCategoryPath() { return categoryPath; }
    public void setCategoryPath(String categoryPath) { this.categoryPath = categoryPath; }
    
    public Float getPrice() { return price; }
    public void setPrice(Float price) { this.price = price; }
    
    public Integer getStock() { return stock; }
    public void setStock(Integer stock) { this.stock = stock; }
    
    public Integer getSalesCount() { return salesCount; }
    public void setSalesCount(Integer salesCount) { this.salesCount = salesCount; }
    
    public String getShopId() { return shopId; }
    public void setShopId(String shopId) { this.shopId = shopId; }
    
    public String getShopName() { return shopName; }
    public void setShopName(String shopName) { this.shopName = shopName; }
    
    public Object getAttributes() { return attributes; }
    public void setAttributes(Object attributes) { this.attributes = attributes; }
    
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
```

#### 2.5 索引管理

**ProductIndexService.java：**

```java
package com.example.es.service;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.mapping.Property;
import co.elastic.clients.elasticsearch.indices.CreateIndexRequest;
import co.elastic.clients.elasticsearch.indices.CreateIndexResponse;
import co.elastic.clients.elasticsearch.indices.ExistsRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Service
public class ProductIndexService {

    @Autowired
    private ElasticsearchClient client;

    private static final String INDEX_NAME = "products_v1";

    public boolean createIndex() throws IOException {
        // 检查索引是否存在
        boolean exists = client.indices().exists(
            ExistsRequest.of(e -> e.index(INDEX_NAME))
        ).value();
        
        if (exists) {
            return false;
        }

        // 定义 mapping
        Map<String, Property> properties = new HashMap<>();
        properties.put("skuId", Property.of(p -> p.keyword(k -> k)));
        properties.put("name", Property.of(p -> p.text(t -> t
            .analyzer("ik_max_word")
            .searchAnalyzer("ik_smart")
        )));
        properties.put("categoryPath", Property.of(p -> p.keyword(k -> k)));
        properties.put("price", Property.of(p -> p.float_(f -> f)));
        properties.put("stock", Property.of(p -> p.integer(i -> i)));
        properties.put("salesCount", Property.of(p -> p.integer(i -> i)));
        properties.put("shopId", Property.of(p -> p.keyword(k -> k)));
        properties.put("shopName", Property.of(p -> p.keyword(k -> k)));
        properties.put("attributes", Property.of(p -> p.object(o -> o)));
        properties.put("createdAt", Property.of(p -> p.date(d -> d.format("yyyy-MM-dd'T'HH:mm:ss"))));

        // 创建索引
        CreateIndexRequest request = CreateIndexRequest.of(c -> c
            .index(INDEX_NAME)
            .mappings(m -> m.properties(properties))
            .settings(s -> s
                .numberOfShards("5")
                .numberOfReplicas("1")
                .refreshInterval("5s")
            )
        );

        CreateIndexResponse response = client.indices().create(request);
        return response.acknowledged();
    }

    public void deleteIndex() throws IOException {
        client.indices().delete(d -> d.index(INDEX_NAME));
    }
}
```

#### 2.6 商品搜索服务

**ProductSearchService.java：**

```java
package com.example.es.service;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.mapping.FieldMapping;
import co.elastic.clients.elasticsearch.core.*;
import co.elastic.clients.elasticsearch.core.search.Hit;
import co.elastic.clients.elasticsearch.core.search.HighlightField;
import com.example.es.model.ProductDocument;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ProductSearchService {

    @Autowired
    private ElasticsearchClient client;

    private static final String INDEX_NAME = "products_v1";

    /**
     * 商品搜索
     */
    public SearchResult search(String keyword, Map<String, Object> filters, int page, int size) throws IOException {
        int from = (page - 1) * size;

        // 构建查询
        SearchRequest.Builder searchBuilder = new SearchRequest.Builder()
            .index(INDEX_NAME)
            .from(from)
            .size(size);

        // 构建 bool 查询
        List<co.elastic.clients.elasticsearch._types.query_dsl.Query> mustQueries = new ArrayList<>();
        List<co.elastic.clients.elasticsearch._types.query_dsl.Query> filterQueries = new ArrayList<>();

        // 关键词搜索（多字段）
        if (keyword != null && !keyword.isEmpty()) {
            mustQueries.add(co.elastic.clients.elasticsearch._types.query_dsl.Query.of(q -> q
                .multiMatch(m -> m
                    .query(keyword)
                    .fields("name^3", "category_path", "shop_name")
                )
            ));
        }

        // 过滤条件
        if (filters != null) {
            if (filters.containsKey("category")) {
                filterQueries.add(co.elastic.clients.elasticsearch._types.query_dsl.Query.of(q -> q
                    .term(t -> t.field("categoryPath").value(v -> v.stringValue((String) filters.get("category"))))
                ));
            }
            
            if (filters.containsKey("priceMin") || filters.containsKey("priceMax")) {
                filterQueries.add(co.elastic.clients.elasticsearch._types.query_dsl.Query.of(q -> q
                    .range(r -> {
                        r.field("price");
                        if (filters.containsKey("priceMin")) {
                            r.gte(JsonData.of(filters.get("priceMin")));
                        }
                        if (filters.containsKey("priceMax")) {
                            r.lte(JsonData.of(filters.get("priceMax")));
                        }
                        return r;
                    })
                ));
            }
        }

        // 组合 bool 查询
        searchBuilder.query(q -> q
            .bool(b -> {
                b.must(mustQueries);
                b.filter(filterQueries);
                return b;
            })
        );

        // 排序
        searchBuilder.sort(s -> s
            .score(sc -> sc.order(SortOrder.Desc))
        );
        searchBuilder.sort(s -> s
            .field(f -> f.field("salesCount").order(SortOrder.Desc))
        );

        // 高亮
        searchBuilder.highlight(h -> h
            .fields("name", HighlightField.of(hf -> hf))
        );

        // 执行搜索
        SearchResponse<ProductDocument> response = client.search(
            searchBuilder.build(),
            ProductDocument.class
        );

        // 解析结果
        List<ProductDocument> items = new ArrayList<>();
        Map<String, Map<String, List<String>>> highlights = new HashMap<>();

        for (Hit<ProductDocument> hit : response.hits().hits()) {
            ProductDocument doc = hit.source();
            items.add(doc);
            
            if (hit.highlight() != null) {
                Map<String, List<String>> docHighlights = new HashMap<>();
                hit.highlight().forEach((field, values) -> 
                    docHighlights.put(field, values)
                );
                highlights.put(hit.id(), docHighlights);
            }
        }

        return new SearchResult(
            (int) response.hits().total().value(),
            items,
            highlights
        );
    }

    /**
     * 根据ID获取商品
     */
    public ProductDocument getById(String id) throws IOException {
        GetResponse<ProductDocument> response = client.get(g -> g
            .index(INDEX_NAME)
            .id(id),
            ProductDocument.class
        );
        return response.found() ? response.source() : null;
    }

    /**
     * 索引商品（新增或更新）
     */
    public void indexProduct(ProductDocument product) throws IOException {
        client.index(i -> i
            .index(INDEX_NAME)
            .id(product.getSkuId())
            .document(product)
        );
    }

    /**
     * 批量索引
     */
    public void bulkIndex(List<ProductDocument> products) throws IOException {
        BulkRequest.Builder bulkBuilder = new BulkRequest.Builder();
        
        for (ProductDocument product : products) {
            bulkBuilder.operations(op -> op
                .index(idx -> idx
                    .index(INDEX_NAME)
                    .id(product.getSkuId())
                    .document(product)
                )
            );
        }
        
        client.bulk(bulkBuilder.build());
    }

    /**
     * 删除商品
     */
    public void deleteProduct(String id) throws IOException {
        client.delete(d -> d.index(INDEX_NAME).id(id));
    }

    // 搜索结果封装类
    public static class SearchResult {
        private final int total;
        private final List<ProductDocument> items;
        private final Map<String, Map<String, List<String>>> highlights;

        public SearchResult(int total, List<ProductDocument> items, 
                           Map<String, Map<String, List<String>>> highlights) {
            this.total = total;
            this.items = items;
            this.highlights = highlights;
        }

        public int getTotal() { return total; }
        public List<ProductDocument> getItems() { return items; }
        public Map<String, Map<String, List<String>>> getHighlights() { return highlights; }
    }
}
```

#### 2.7 数据同步服务（监听 Binlog）

**ProductSyncService.java：**

```java
package com.example.es.service;

import com.example.es.model.ProductDocument;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Service
public class ProductSyncService {

    @Autowired
    private ProductSearchService searchService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = "db_product", groupId = "es-sync-group")
    public void consume(ConsumerRecord<String, String> record) throws IOException {
        JsonNode data = objectMapper.readTree(record.value());
        String type = data.get("type").asText();
        JsonNode payload = data.get("data");

        switch (type) {
            case "INSERT":
            case "UPDATE":
                ProductDocument doc = convertToDocument(payload);
                searchService.indexProduct(doc);
                break;
            case "DELETE":
                String id = payload.get("id").asText();
                searchService.deleteProduct(id);
                break;
        }
    }

    private ProductDocument convertToDocument(JsonNode payload) {
        ProductDocument doc = new ProductDocument();
        doc.setSkuId(payload.get("id").asText());
        doc.setName(payload.get("name").asText());
        doc.setCategoryPath(payload.get("category_path").asText());
        doc.setPrice(payload.get("price").floatValue());
        doc.setStock(payload.get("stock").asInt());
        doc.setSalesCount(payload.get("sales_count").asInt());
        doc.setShopId(payload.get("shop_id").asText());
        doc.setShopName(payload.get("shop_name").asText());
        
        String dateStr = payload.get("created_at").asText();
        doc.setCreatedAt(LocalDateTime.parse(dateStr, 
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        
        return doc;
    }
}
```

#### 2.8 数据同步方案对比

| 方案 | 适用场景 | 延迟 | 复杂度 |
| --- | --- | --- | --- |
| 双写 | 数据量小，实时性高 | 实时 | 低 |
| 监听 Binlog | 已有 MySQL，不想改代码 | 秒级 | 中 |
| 定时同步 | 离线分析，允许延迟 | 分钟级 | 低 |
| CDC (Debezium) | 大规模，多数据源 | 秒级 | 高 |

**推荐**：Binlog 监听方案（Canal/Maxwell + Kafka）

* * *

### 三、适配的业务场景

#### 3.1 站内搜索（最常用）

-   电商商品搜索
-   文档/知识库检索
-   内容社区搜索

**特点**：需要分词、相关性排序、facets 过滤

#### 3.2 日志分析（ELK 栈）

**Filebeat 配置：**

```yaml
filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /var/log/app/*.log
  multiline.pattern: '^['
  multiline.negate: true
  multiline.match: after
  fields:
    service: order-service
    env: production

output.elasticsearch:
  hosts: ["es-node1:9200", "es-node2:9200"]
  index: "app-logs-%{+yyyy.MM.dd}"
```

**典型查询：**

```bash
GET /app-logs-*/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "level": "ERROR" }},
        { "range": {
          "@timestamp": {
            "gte": "now-1h",
            "lte": "now"
          }
        }}
      ]
    }
  },
  "aggs": {
    "error_by_service": {
      "terms": { "field": "service.keyword" }
    }
  }
}
```

#### 3.3 指标监控

-   APM 链路追踪
-   系统性能指标
-   业务指标看板

**配合 Grafana/Kibana 做可视化**

#### 3.4 推荐系统

```bash
GET /products/_search
{
  "query": {
    "more_like_this": {
      "fields": ["category_path", "attributes"],
      "like": [
        { "_id": "sku_100" },
        { "_id": "sku_200" }
      ],
      "min_term_freq": 1,
      "max_query_terms": 12
    }
  }
}
```

#### 3.5 地理位置服务

```bash
PUT /locations/_doc/shop_001
{
  "name": "星巴克三里屯店",
  "location": {
    "lat": 39.934,
    "lon": 116.455
  }
}
```

**附近搜索：**

```bash
GET /locations/_search
{
  "query": {
    "geo_distance": {
      "distance": "1km",
      "location": {
        "lat": 39.934,
        "lon": 116.455
      }
    }
  },
  "sort": [
    {
      "_geo_distance": {
        "location": { "lat": 39.934, "lon": 116.455 },
        "order": "asc",
        "unit": "m"
      }
    }
  ]
}
```

* * *

### 四、生产常见问题处理

#### 4.1 集群健康监控

```bash
# 查看集群健康状态
curl -X GET "localhost:9200/_cluster/health"
```

**关键指标：**

-   **status**: green/yellow/red
-   **relocating_shards**: 正在迁移的分片
-   **initializing_shards**: 正在初始化的分片
-   **unassigned_shards**: 未分配的分片（危险！）

**状态说明：**

-   **Green**：所有分片正常
-   **Yellow**：主分片正常，副本缺失（通常是一台节点挂了）
-   **Red**：主分片缺失（数据可能丢失！）

#### 4.2 性能调优

**查询慢？**

```bash
# 查看慢查询日志
GET /_cluster/settings
{
  "transient": {
    "index.search.slowlog.threshold.query.warn": "10s",
    "index.search.slowlog.threshold.query.info": "5s",
    "index.search.slowlog.threshold.fetch.warn": "1s"
  }
}
```

**优化建议：**

-   避免 deep paging，用 search_after
-   大聚合用 composite aggregation
-   禁用 _source 如果不需要原文
-   使用 filter context 缓存

**写入慢？**

```bash
# 调整 bulk size（通常 5-15MB）

# 批量导入时禁用刷新
PUT /my_index/_settings
{
  "refresh_interval": "-1"
}

# 导入时减少副本
PUT /my_index/_settings
{
  "number_of_replicas": 0
}
```

#### 4.3 内存问题

**JVM** ******内存** **配置建议：**

-   不要超过 32GB（压缩指针失效）
-   通常配置为物理内存的 50%，但不超过 30GB
-   剩余内存给文件系统缓存

```diff
# elasticsearch.yml
-Xms16g
-Xmx16g
```

**查看** **内存** **使用：**

```bash
GET /_nodes/stats/jvm

# 查看热点线程
GET /_nodes/hot_threads
```

**常见** **OOM** **原因：**

1.  聚合查询太复杂（大 cardinality 字段做 terms agg）
2.  分片数量过多（每分片需要内存）
3.  字段爆炸（mapping 字段数失控）

#### 4.4 磁盘空间管理

```bash
# 磁盘水位线配置
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.disk.watermark.low": "85%",
    "cluster.routing.allocation.disk.watermark.high": "90%",
    "cluster.routing.allocation.disk.watermark.flood_stage": "95%"
  }
}
```

**ILM** **索引生命周期管理：**

```bash
PUT /_ilm/policy/logs_policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "3d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": { "delete": {} }
      }
    }
  }
}
```

#### 4.5 数据备份与恢复

```bash
# 注册快照仓库
PUT /_snapshot/my_backup
{
  "type": "fs",
  "settings": {
    "location": "/mnt/es_backup",
    "compress": true
  }
}

# 创建快照
PUT /_snapshot/my_backup/snapshot_20240115?wait_for_completion=true
{
  "indices": "products_v1,orders_v1",
  "ignore_unavailable": true,
  "include_global_state": false
}

# 恢复快照
POST /_snapshot/my_backup/snapshot_20240115/_restore
{
  "indices": "products_v1"
}
```

#### 4.6 版本升级

**滚动升级（不停机）：**

1.  先升级主节点（不存储数据）
2.  逐个升级数据节点
3.  每次升级后等集群恢复 green 再下一个

**注意事项：**

-   跨大版本升级需先升级到中间版本
-   升级前务必快照
-   检查 breaking changes

* * *

### 五、总结

ES 是个好东西，但生产环境用起来要考虑的不少：

1.  **索引设计**：提前规划 mapping，避免字段爆炸
2.  **数据同步**：选合适的同步方案，保证一致性
3.  **集群规划**：数据节点至少 3 个，避免脑裂
4.  **监控告警**：集群状态、慢查询、磁盘空间都要监控
5.  **定期维护**：索引生命周期管理、快照备份

有问题先看日志，再查 `/_cluster/health` 和 `/_nodes/stats`，大部分情况都能找到线索。

* * *

_文章基于_ _Elasticsearch_ _8.x 版本，部分_ _API_ _在低版本可能有差异。_
