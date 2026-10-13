#!/usr/bin/env node
/**
 * 掘金文章批量导出
 *
 * 数据来源：
 *   - 文章列表/元数据: 掘金内容 API（无需登录）
 *   - 正文: 文章页 SSR HTML（article 节点）→ turndown 转 Markdown
 *     （detail 接口已要求登录态，故正文走页面提取）
 *
 * 用法:
 *   node tools/export-juejin.mjs <用户ID> [--limit N]
 *   用户ID: 个人主页 URL https://juejin.cn/user/<ID> 中的那串数字
 * 输出:
 *   _inbox/<article_id>.md   每篇一个文件（frontmatter + Markdown 正文）
 *   _inbox/manifest.json     全量元数据清单（后续归类用）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, '_inbox');

// ---------- 参数 ----------
let userId = null;
let limit = Infinity;
let onlyIds = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--limit') limit = Number(argv[++i]);
  else if (argv[i] === '--ids') onlyIds = argv[++i].split(',');
  else userId = argv[i];
}
if (!userId || !/^\d+$/.test(userId)) {
  console.error('用法: node tools/export-juejin.mjs <用户ID> [--limit N] [--ids id1,id2,...]');
  console.error('用户ID 见个人主页 URL: https://juejin.cn/user/<ID>');
  process.exit(1);
}

// ---------- HTTP ----------
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://juejin.cn' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

function fmtDate(sec) {
  const ms = Number(sec) > 1e12 ? Number(sec) : Number(sec) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------- 1. 分页拉取文章列表（元数据） ----------
const all = [];
let cursor = '0';
for (let page = 0; page < 50; page++) {
  const json = await postJson('https://api.juejin.cn/content_api/v1/article/query_list', {
    user_id: userId,
    cursor,
    sort_type: 2,
    limit: 20,
  });
  if (json.err_no !== 0) throw new Error(`列表接口 err_no=${json.err_no} ${json.err_msg ?? ''}`);
  const items = (Array.isArray(json.data) ? json.data : []).map((it) => {
    const a = it.article_info ?? {};
    return {
      id: String(a.article_id ?? it.article_id),
      title: a.title ?? '(无标题)',
      brief: a.brief_content ?? '',
      ctime: a.ctime,
      views: a.view_count ?? 0,
      likes: a.digg_count ?? 0,
      comments: a.comment_count ?? 0,
      collects: a.collect_count ?? 0,
      isMarkdown: a.is_markdown === 1,
    };
  });
  all.push(...items.filter((it) => it.id));
  console.log(`[list] 已获取 ${all.length} 篇 (has_more=${json.has_more})`);
  if (items.length === 0 || !json.has_more || all.length >= limit) break;
  cursor = String(json.cursor ?? '');
  if (!cursor) break;
  await sleep(300);
}
if (all.length === 0) {
  console.error('未拉到任何文章：请检查用户ID是否正确');
  process.exit(1);
}

// ---------- 2. 逐篇抓取文章页并转换正文 ----------
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.use(gfm);
turndown.remove(['style', 'script']);

mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
const targets = (onlyIds ? all.filter((it) => onlyIds.includes(it.id)) : all).slice(0, limit);

for (const [i, meta] of targets.entries()) {
  try {
    const res = await fetch(`https://juejin.cn/post/${meta.id}`, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`文章页 HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const article = $('article.article').first();
    if (article.length === 0) throw new Error('未找到 article 节点（可能触发了风控页）');

    // 去掉页内自带的标题 h1、作者栏、日期阅读数栏、目录、操作栏
    article
      .find(
        'h1.article-title, .author-info-block, .meta-box, ul.article-sentence-list, .article-bar',
      )
      .remove();
    const innerHtml = article.html() ?? '';
    let markdown = turndown.turndown(innerHtml).trim();

    // turndown 输出保留转义符过多，做轻量清理
    markdown = markdown.replace(/\\([`*_{}[\]()#+!~-])/g, '$1');

    const fm = [
      '---',
      `title: ${JSON.stringify(meta.title)}`,
      `pubDate: ${fmtDate(meta.ctime)}`,
      'category: ""  # 待归类: backend | practice | ai | career',
      'tags: []',
      `summary: ${JSON.stringify(meta.brief.slice(0, 100))}`,
      'draft: true',
      'juejin:',
      `  id: "${meta.id}"`,
      `  url: https://juejin.cn/post/${meta.id}`,
      `  views: ${meta.views}`,
      `  likes: ${meta.likes}`,
      '---',
      '',
    ].join('\n');

    writeFileSync(join(OUT_DIR, `${meta.id}.md`), `${fm}${markdown}\n`, 'utf8');
    manifest.push(meta);
    console.log(`[${i + 1}/${targets.length}] ${meta.title}`);
  } catch (err) {
    console.error(`[${i + 1}/${targets.length}] 失败: ${meta.title} -> ${err.message}`);
    manifest.push({ ...meta, error: err.message });
  }
  await sleep(1200);
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
const failed = manifest.filter((m) => m.error).length;
console.log(`\n完成: 成功 ${manifest.length - failed} / ${manifest.length}，输出目录 ${OUT_DIR}`);
if (failed) console.log(`${failed} 篇失败，明细见 manifest.json 中带 error 字段的条目`);
