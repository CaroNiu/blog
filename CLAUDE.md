# 博客项目工作约定

个人技术博客「后端不背锅」。长线规划见 `docs/长期内容规划.md`（先读它），选题池见 `docs/选题库.md`。

## 目录

- `src/content/posts/backend|practice|ai|career/` — 文章正式库（backend=后端进阶, practice=实战复盘, ai=AI×程序员, career=职业思考）
- `_inbox/` — 掘金导出暂存区、素材收件箱（待整理，不发布）
- `docs/` — 规划与选题库
- `tools/` — 维护脚本（导出、校验等）
- `原文档/` — 掘金截图等原始素材

## 文章 frontmatter 规范（正式库强制）

```yaml
---
title: 文章标题
pubDate: 2026-10-13
category: backend        # backend | practice | ai | career，与目录一致
series: 支付与一致性      # 可选
tags: [Redis, 幂等]
summary: 一句话摘要，列表页与 SEO 用
draft: false
juejin:
  id: "7xxxxxxxxxxxxxxx"
  url: https://juejin.cn/post/7xxxxxxxxxxxxxxx   # 发布后回填
  stats: { views: 0, likes: 0 }                   # 月度数据回收时更新
---
```

## 写作流水线（新文章一律走此流程）

1. **选题**：从 `docs/选题库.md` 取题或提案新题，用户拍板后标"已排期"
2. **大纲**：AI 生成 → 用户确认结构
3. **初稿**：先读 article-evolution 技能的 `WRITING_RULES.md` 再写，应用全部已积累的风格规则
4. **人工校准**：用户核技术正确性、注入真实经验
5. **风格记录**：把本次用户的修改逻辑归纳回写 `WRITING_RULES.md`（每次必做）
6. **归档**：frontmatter 补齐 → `draft: false` → 存入对应 category 目录
7. **双发**：用户发掘金后回填 `juejin.url`

## 红线

- **实战复盘类**（practice）：项目细节、数字、截图必须来自用户真实经历，AI 只做结构化，不得编造
- 技术论断必须有依据，AI 不确定处显式标注待核实
- 不过人工校准不发布；`draft: true` 的文件不进站点构建

## 常用操作

- 存量迁移：`node tools/export-juejin.mjs <掘金用户ID>`（导出到 `_inbox/`，再人工/AI 归类到 posts/）
- 月度数据回收：更新各篇 `juejin.stats` + 调整 `docs/选题库.md` 优先级
- 素材收集：随手追加到 `_inbox/素材收件箱.md`
