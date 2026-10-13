---
title: "Docker 从入门到实战：容器化部署不再难"
date: 2026-03-16
updated: 2026-03-16
categories:
  - 后端进阶
tags: []
description: "前言 \"在我机器上能跑啊！\" 这句话是每个后端开发者的噩梦。Docker 就是来解决这个问题的。 这篇文章手把手教你 Docker，从安装到实战，部署一个完整的 Spring Boot 项目。 一、D"
juejin:
  id: "7617277037111279659"
  url: https://juejin.cn/post/7617277037111279659
  views: 313
  likes: 0
---

## 前言

"在我机器上能跑啊！"

这句话是每个后端开发者的噩梦。Docker 就是来解决这个问题的。

这篇文章手把手教你 Docker，从安装到实战，部署一个完整的 Spring Boot 项目。

* * *

## 一、Docker 是什么？

### 1.1 概念解释

**传统部署**：

-   装操作系统 → 装 JDK → 装 MySQL → 配环境变量 → 部署应用
-   问题：环境不一致，换台机器可能就挂了

**Docker 部署**：

-   把应用和所有依赖打包成一个"镜像"
-   服务器上只需要安装 Docker，直接运行镜像
-   一次打包，到处运行

### 1.2 核心概念

| 概念 | 解释 | 类比 |
| --- | --- | --- |
| **镜像（Image）** | 模板，只读的 | 类（Class） |
| **容器（Container）** | 镜像的运行实例 | 对象（Object） |
| **仓库（** **Repository** **）** | 存放镜像的地方 | Maven 仓库 |

### 1.3 为什么用 Docker？

-   ✅ **环境一致性**：开发、测试、生产环境一致
-   ✅ **快速部署**：秒级启动应用
-   ✅ **资源隔离**：不同容器互不影响
-   ✅ **弹性伸缩**：快速扩缩容

* * *

## 二、Docker 安装

### 2.1 Linux 安装（Ubuntu）

```bash
# 1. 更新 apt
sudo apt-get update

# 2. 安装依赖
sudo apt-get install ca-certificates curl gnupg lsb-release

# 3. 添加 Docker GPG 密钥
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 4. 添加 Docker 仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 5. 安装 Docker
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 6. 验证安装
docker --version
```

### 2.2 Mac/Windows 安装

-   **Mac**：直接下载 [Docker Desktop](https://link.juejin.cn?target=https%3A%2F%2Fwww.docker.com%2Fproducts%2Fdocker-desktop%2F "https://www.docker.com/products/docker-desktop/")
-   **Windows**：需要 WSL2 支持，推荐用 Docker Desktop

### 2.3 配置镜像加速

国内访问 Docker Hub 很慢，需要配置镜像加速。

```bash
# 创建配置目录
sudo mkdir -p /etc/docker

# 配置镜像加速
sudo tee /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ]
}
EOF

# 重启 Docker
sudo systemctl daemon-reload
sudo systemctl restart docker
```

* * *

## 三、Docker 基础命令

### 3.1 镜像操作

```bash
# 搜索镜像
docker search nginx

# 拉取镜像
docker pull nginx:latest

# 查看镜像列表
docker images

# 删除镜像
docker rmi nginx:latest

# 构建镜像
docker build -t myapp:1.0 .
```

### 3.2 容器操作

```bash
# 运行容器
docker run -d -p 8080:80 --name mynginx nginx

# 参数说明：
# -d: 后台运行
# -p 8080:80: 端口映射（主机端口:容器端口）
# --name: 容器名称
# nginx: 镜像名

# 查看运行中的容器
docker ps

# 查看所有容器（包括停止的）
docker ps -a

# 停止容器
docker stop mynginx

# 启动容器
docker start mynginx

# 删除容器
docker rm mynginx

# 查看容器日志
docker logs -f mynginx

# 进入容器内部
docker exec -it mynginx /bin/bash
```

### 3.3 实战：运行 MySQL

```ini
# 运行 MySQL 容器
docker run -d \
  --name mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=123456 \
  -e MYSQL_DATABASE=testdb \
  -v mysql-data:/var/lib/mysql \
  mysql:8.0

# 参数说明：
# -e: 环境变量
# -v: 数据卷挂载（持久化数据）
```

* * *

## 四、Dockerfile 实战

### 4.1 什么是 Dockerfile？

Dockerfile 是用来构建镜像的脚本文件。

```bash
# 基础镜像
FROM openjdk:17-jdk-slim

# 维护者信息
MAINTAINER yourname <email@example.com>

# 工作目录
WORKDIR /app

# 复制文件
COPY target/myapp.jar /app/

# 暴露端口
EXPOSE 8080

# 启动命令
ENTRYPOINT ["java", "-jar", "myapp.jar"]
```

### 4.2 Spring Boot 项目实战

**项目结构**：

```css
myapp/
├── src/
├── target/
│   └── myapp.jar
├── Dockerfile
└── docker-compose.yml
```

**Dockerfile**：

```bash
# 多阶段构建，减小镜像体积

# 阶段1：构建
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# 阶段2：运行
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar

# 时区设置
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# JVM 参数
ENV JAVA_OPTS="-Xms256m -Xmx512m -XX:+UseG1GC"

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

### 4.3 构建和运行

```bash
# 1. 构建镜像
docker build -t myapp:1.0 .

# 2. 运行容器
docker run -d \
  --name myapp \
  -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=prod \
  -v /data/logs:/app/logs \
  myapp:1.0

# 3. 查看日志
docker logs -f myapp

# 4. 查看状态
docker stats myapp
```

* * *

## 五、Docker Compose 实战

### 5.1 什么是 Docker Compose？

Docker Compose 用来定义和运行多容器应用。

```yaml
# docker-compose.yml
version: '3.8'

services:
  # MySQL 服务
  mysql:
    image: mysql:8.0
    container_name: myapp-mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: 123456
      MYSQL_DATABASE: myapp
      TZ: Asia/Shanghai
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - myapp-network

  # Redis 服务
  redis:
    image: redis:7-alpine
    container_name: myapp-redis
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - myapp-network

  # 应用服务
  app:
    build: .
    container_name: myapp
    restart: always
    depends_on:
      - mysql
      - redis
    environment:
      SPRING_PROFILES_ACTIVE: prod
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/myapp?useSSL=false&serverTimezone=Asia/Shanghai
      SPRING_DATA_REDIS_HOST: redis
    ports:
      - "8080:8080"
    volumes:
      - /data/logs:/app/logs
    networks:
      - myapp-network

# 数据卷
volumes:
  mysql-data:
  redis-data:

# 网络
networks:
  myapp-network:
    driver: bridge
```

### 5.2 常用命令

```ini
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f app

# 停止所有服务
docker-compose down

# 重新构建并启动
docker-compose up -d --build

# 扩容（需要配置 scale）
docker-compose up -d --scale app=3
```

* * *

## 六、生产环境最佳实践

### 6.1 镜像优化

1.  **使用多阶段构建**：减小镜像体积
2.  **使用 Alpine 基础镜像**：Alpine 镜像只有 5MB
3.  **减少层数**：合并 RUN 指令
4.  **.dockerignore**：排除不需要的文件

```bash
# 不好：多层 COPY
COPY pom.xml /tmp/
WORKDIR /tmp
RUN mvn dependency:go-offline
COPY src /tmp/src
RUN mvn package

# 好：合并层
COPY pom.xml .
COPY src .
RUN mvn package -DskipTests
```

### 6.2 安全配置

```sql
# 使用非 root 用户
FROM openjdk:17-jre-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

### 6.3 日志管理

```yaml
# docker-compose.yml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 6.4 健康检查

```bash
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1
```

* * *

## 七、常见问题

### ❌ 问题 1：容器无法启动

```bash
# 查看日志
docker logs <container_id>

# 常见原因：
# - 端口被占用：换一个端口
# - 权限不足：检查 volume 权限
# - 环境变量缺失：检查 -e 配置
```

### ❌ 问题 2：数据丢失

```bash
# 原因：容器删除后数据丢失
# 解决：使用 volume 持久化数据

# 查看 volume
docker volume ls

# 持久化 MySQL 数据
-v mysql-data:/var/lib/mysql
```

### ❌ 问题 3：网络不通

```bash
# 检查网络
docker network ls
docker network inspect myapp-network

# 常见原因：
# - 容器不在同一网络
# - 服务名写错（区分大小写）
```

* * *

## 总结

这篇文章覆盖了 Docker 核心知识：

✅ **Docker 概念**：镜像、容器、仓库 ✅ **安装配置**：Linux/Mac/Windows + 镜像加速 ✅ **基础命令**：run、ps、logs、exec ✅ **Dockerfile**：多阶段构建、优化技巧 ✅ **Docker Compose**：多容器编排 ✅ **生产实践**：安全、日志、健康检查

**下一步建议**：

1.  在本地搭建 Docker 环境
2.  把自己的项目 Docker 化
3.  学习 Kubernetes（K8s）

* * *

> 💡 **互动**：你在 Docker 部署中遇到过什么问题？评论区分享一下！

> 下一期：《微服务架构：什么时候该用，什么时候不该用》，敬请期待！🚀
