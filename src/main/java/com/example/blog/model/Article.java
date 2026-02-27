package com.example.blog.model;

import java.time.Instant;

public record Article(
        Long id,
        String title,
        String summary,
        String content,
        String author,
        Instant publishedAt
) {
}
