import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 文章集合：schema 即 frontmatter 规范的强制校验，
// 不合规的文章会在构建期直接报错（规范见 CLAUDE.md）
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    category: z.enum(['backend', 'practice', 'ai', 'career']),
    series: z.string().optional(),
    tags: z.array(z.string()).default([]),
    summary: z.string().default(''),
    draft: z.boolean().default(false),
    juejin: z
      .object({
        id: z.string().optional(),
        url: z.string().url().optional(),
        stats: z
          .object({
            views: z.number().optional(),
            likes: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export const collections = { posts };
