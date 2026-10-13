---
title: "大模型应用开发：从 Prompt 到 RAG 实战"
pubDate: 2026-03-25
category: ai
tags: []
summary: "大模型应用开发：从 Prompt 到 RAG 实战 一、大模型基础 1.1 常见大模型 模型 特点 适用场景 GPT-4 全能 通用对话 Claude 长文本 文档处理 文心一言 中文优化 中文场景 "
draft: false
juejin:
  id: "7620864119612653610"
  url: https://juejin.cn/post/7620864119612653610
  views: 107
  likes: 0

---
## 大模型应用开发：从 Prompt 到 RAG 实战

> AI 大模型时代，后端开发者如何转型？本文带你掌握大模型应用开发。

* * *

### 一、大模型基础

#### 1.1 常见大模型

| 模型 | 特点 | 适用场景 |
| --- | --- | --- |
| GPT-4 | 全能 | 通用对话 |
| Claude | 长文本 | 文档处理 |
| 文心一言 | 中文优化 | 中文场景 |
| 通义千问 | 开源可用 | 企业部署 |

#### 1.2 调用方式

```typescript
// OpenAI API
@Configuration
public class OpenAIConfig {
    
    @Value("${openai.api.key}")
    private String apiKey;
    
    @Bean
    public OpenAI openAI() {
        return new OpenAI.Builder(apiKey).build();
    }
}

@Service
public class ChatService {
    
    @Autowired
    private OpenAI openAI;
    
    public String chat(String prompt) {
        ChatCompletion completion = openAI.chatCompletions()
            .create(new ChatCompletionCreateParams.Builder()
                .model("gpt-4")
                .messages(List.of(
                    new ChatMessage("user", prompt)
                ))
                .build());
        
        return completion.choices().get(0).message().content();
    }
}
```

* * *

### 二、Prompt 工程

#### 2.1 Prompt 原则

```markdown
1. 明确任务 - 说清楚要什么
2. 提供上下文 - 背景信息
3. 给示例 -Few-shot 学习
4. 设定角色 - AI 更专业
5. 格式要求 - 输出格式
```

#### 2.2 Prompt 示例

```markdown
// ❌ 模糊
"帮我写代码"

// ✅ 清晰
"你是一个 Java 工程师，写一个用户注册接口，包含：
1. 参数校验（邮箱、手机号）
2. 密码加密存储（BCrypt）
3. 返回 JWT Token
4. 使用 Spring Boot 3.x
5. 代码要有注释"
```

* * *

### 三、LangChain4j 实战

#### 3.1 引入依赖

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j</artifactId>
    <version>0.35.0</version>
</dependency>
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-open-ai</artifactId>
    <version>0.35.0</version>
</dependency>
```

#### 3.2 基本对话

```arduino
@Service
public class AIService {
    
    private final ChatLanguageModel model;
    
    public AIService() {
        this.model = OpenAiChatModel.builder()
            .apiKey(System.getenv("OPENAI_API_KEY"))
            .modelName("gpt-4")
            .temperature(0.7)
            .build();
    }
    
    public String chat(String message) {
        return model.chat(message);
    }
}
```

* * *

### 四、RAG（检索增强生成）

#### 4.1 RAG 架构

```markdown
用户问题 → 向量化 → 向量数据库检索 
                        ↓
              相关文档 + LLM 生成答案
```

#### 4.2 实现步骤

```ini
// 1. 文档加载
DocumentLoader loader = new TextLoader(
    new FileSystemResource("docs/user-manual.txt")
);
List<Document> documents = loader.load();

// 2. 文档分块
TextSplitter splitter = new DocumentByParagraphTextSplitter();
List<TextSegment> segments = splitter.split(documents);

// 3. 向量化
EmbeddingModel embeddingModel = new OpenAiEmbeddingModel();
List<Embedding> embeddings = embeddingModel.embedAll(segments).content();

// 4. 存入向量库
VectorStore store = new InMemoryVectorStore(embeddingModel);
store.add(segments);

// 5. 检索+生成
String query = "如何重置密码？";
List<TextSegment> relevant = store.findRelevant(query, 3);

String prompt = "根据以下文档回答：\n" +
    relevant.stream()
        .map(TextSegment::text)
        .collect(Collectors.joining("\n")) +
    "\n\n问题：" + query;

String answer = model.chat(prompt);
```

#### 4.3 使用向量数据库

```xml
<!-- Milvus -->
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-milvus</artifactId>
    <version>0.35.0</version>
</dependency>

<!-- Pinecone -->
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-pinecone</artifactId>
    <version>0.35.0</version>
</dependency>
```

```scss
// Milvus 向量库
VectorStore store = MilvusEmbeddingStore.builder()
    .host("localhost")
    .port(19530)
    .collectionName("docs")
    .dimension(1536)
    .embeddingModel(embeddingModel)
    .build();
```

* * *

### 五、Function Calling

#### 5.1 定义工具

```less
public class WeatherService {
    
    @Tool("获取指定城市的天气信息")
    public String getWeather(@P("城市名称") String city) {
        // 调用第三方天气 API
        return "北京今天晴，25°C";
    }
}
```

#### 5.2 使用工具

```ini
ChatLanguageModel model = OpenAiChatModel.builder()
    .apiKey(apiKey)
    .tools(List.of(new WeatherService()))
    .build();

UserMessage userMessage = UserMessage.from(
    "北京今天天气怎么样？"
);

Response<AiMessage> response = model.chat(userMessage);
AiMessage aiMessage = response.content();

// 如果 AI 决定调用工具
if (aiMessage.hasToolExecutionRequests()) {
    // 执行工具
    List<ToolExecution> executions = aiMessage.toolExecutionRequests();
    for (ToolExecution execution : executions) {
        Object result = toolExecutor.execute(execution);
        // 继续调用模型生成最终答案
    }
}
```

* * *

### 六、应用场景

| 场景 | RAG | Function Calling |
| --- | --- | --- |
| 客服问答 | ✅ | ❌ |
| 数据查询 | ❌ | ✅ |
| 智能助手 | ✅ | ✅ |
| 内容生成 | ❌ | ✅ |

* * *

### 七、最佳实践

```markdown
1. Prompt 要具体明确
2. RAG 检索要精准分块
3. 注意 API 成本控制
4. 做好安全过滤
5. 做好降级方案
```

* * *
