# Personal Blog System (Java + Spring Boot)

已将后端重构为 **Java Spring Boot**，并提供可直接访问的前端页面。

## 功能

- Java 后端 REST API：`/api/v1/articles`
- 内置静态前端页面：`/`
- 启动后即可通过浏览器访问前端并读取后端数据

## 本地运行

```bash
mvn spring-boot:run
```

启动完成后访问：

- 前端页面地址：`http://localhost:8080/`
- 后端接口地址：`http://localhost:8080/api/v1/articles`

## 打包部署（后端）

```bash
mvn clean package
java -jar target/blog-0.0.1-SNAPSHOT.jar
```

## Docker 部署

```bash
docker build -t blog-java .
docker run -d --name blog-java -p 8080:8080 blog-java
```

部署后前端访问地址：`http://<你的服务器IP>:8080/`

## 测试

```bash
mvn test
```
