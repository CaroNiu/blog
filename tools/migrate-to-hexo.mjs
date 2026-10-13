#!/usr/bin/env node
/**
 * 一次性迁移：Astro content (src/content/posts/{cat}/*.md) → Hexo (source/_posts/{cat}/*.md)
 * frontmatter 映射：
 *   title            → title（原样）
 *   pubDate          → date + updated（固定日期，避免 Hexo 用文件 mtime 当更新时间）
 *   category         → categories 一级分类（中文内容线）
 *   series           → categories 二级分类（有 series 时）
 *   tags             → tags（原样）
 *   summary          → description（Hexo/主题惯用字段）
 *   draft:false      → 略（Hexo 草稿放 _drafts 目录，存量 43 篇均为已发布）
 *   juejin 块        → 原样保留（自定义元数据，双发/数据回收用）
 * 用法: node tools/migrate-to-hexo.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src', 'content', 'posts');
const DEST = join(ROOT, 'source', '_posts');

const CATEGORY_CN = {
  backend: '后端进阶',
  practice: '实战复盘',
  ai: 'AI×程序员',
  career: '职业思考',
};

function parseFrontmatter(raw) {
  const end = raw.indexOf('---', 3);
  if (!raw.startsWith('---') || end === -1) throw new Error('frontmatter 缺失');
  return { fm: raw.slice(3, end), body: raw.slice(end + 3) };
}

function pick(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

function block(fm, key) {
  // 提取多行块（如 juejin:），含缩进子行
  const lines = fm.split('\n');
  const out = [];
  let on = false;
  for (const line of lines) {
    if (new RegExp(`^${key}:`).test(line)) {
      on = true;
      out.push(line);
      continue;
    }
    if (on) {
      if (/^\s+\S/.test(line)) out.push(line);
      else break;
    }
  }
  return out.join('\n');
}

let count = 0;
const errors = [];

for (const cat of readdirSync(SRC)) {
  const catDir = join(SRC, cat);
  const files = readdirSync(catDir).filter((f) => f.endsWith('.md'));
  mkdirSync(join(DEST, cat), { recursive: true });

  for (const file of files) {
    try {
      const raw = readFileSync(join(catDir, file), 'utf8');
      const { fm, body } = parseFrontmatter(raw);

      const title = pick(fm, 'title');
      const pubDate = pick(fm, 'pubDate');
      const summary = pick(fm, 'summary') ?? '""';
      const juejin = block(fm, 'juejin');
      const tagsM = fm.match(/^tags:\s*(\[[^\]]*\])\s*$/m);
      const tags = tagsM ? tagsM[1] : '[]';

      if (!title || !pubDate) throw new Error('缺 title/pubDate');

      const categories = [CATEGORY_CN[cat] ?? cat];
      const series = pick(fm, 'series');
      if (series && series !== '""') categories.push(series.replace(/^"|"$/g, ''));

      const out = [
        '---',
        `title: ${title}`,
        `date: ${pubDate}`,
        `updated: ${pubDate}`,
        'categories:',
        ...categories.map((c) => `  - ${c}`),
        `tags: ${tags}`,
        `description: ${summary}`,
        ...(juejin ? [juejin] : []),
        '---',
        '',
        body.replace(/^\n+/, ''),
      ].join('\n');

      writeFileSync(join(DEST, cat, file), out, 'utf8');
      count++;
    } catch (err) {
      errors.push(`${cat}/${file}: ${err.message}`);
    }
  }
}

console.log(`迁移完成: ${count} 篇 → source/_posts/`);
if (errors.length) {
  console.log('失败:');
  errors.forEach((e) => console.log('  ' + e));
}
