package com.example.blog.service;

import com.example.blog.model.Article;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class ArticleService {

    public List<Article> findAllPublished() {
        return List.of(
                new Article(1L, "Java 后端重构完成", "Spring Boot 提供 REST API", "后端由 Java 驱动，前端可直接访问。", "admin", Instant.parse("2026-02-01T08:00:00Z")),
                new Article(2L, "部署说明", "支持本地与容器部署", "使用 Maven 打包并运行 Jar 即可。", "admin", Instant.parse("2026-02-03T10:30:00Z"))
        );
    }
}
