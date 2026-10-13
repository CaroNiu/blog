#!/usr/bin/env node
/**
 * 掘金文章批量导出
 *
 * 用法:
 *   node tools/export-juejin.mjs <用户ID> [--limit N]
 *   用户ID: 个人主页 URL https://juejin.cn/user/<ID> 中的那串数字
 * 可选环境变量:
 *   JUEJIN_COOKIE  登录态 cookie（接口要求鉴权时设置）
 * 输出:
 *   _inbox/<article_id>.md   每篇一个文件（frontmatter + Markdown 正文）
 *   _inbox/manifest.json     全量元数据清单（后续归类用）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, '_inbox');

// ---------- 参数 ----------
let userId = null;
let limit = Infinity;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--limit') limit = Number(argv[++i]);
  else userId = argv[i];
}
if (!userId || !/^\d+$/.test(userId)) {
  console.error('用法: node tools/export-juejin.mjs <用户ID> [--limit N]');
  console.error('用户ID 见个人主页 URL: https://juejin.cn/user/<ID>');
  process.exit(1);
}

// ---------- HTTP ----------
const API = 'https://api.juejin.cn/content_api/v1';
const headers = {
  'content-type': 'application/json',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};
if (process.env.JUEJIN_COOKIE) headers.cookie = process.env.JUEJIN_COOKIE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const json = await res.json();
  if (json.err_no !== 0) throw new Error(`${path} err_no=${json.err_no} err_msg=${json.err_msg ?? ''}`);
  return json;
}

// query_list 返回结构做防御性适配（裸数组或包一层对象都兼容）
function extractArticles(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['articles', 'list', 'article_list']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function fmtDate(sec) {
  const ms = sec > 1e12 ? sec : sec * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------- 1. 分页拉取文章列表 ----------
const all = [];
let cursor = '0';
for (let page = 0; page < 50; page++) {
  const json = await post('/article/query_list', { user_id: userId, cursor, sort_type: 2, limit: 20 });
  const items = extractArticles(json.data).map((it) => it.article_info ?? it);
  all.push(...items);
  console.log(`[list] 已获取 ${all.length} 篇`);
  if (items.length === 0 || all.length >= limit) break;
  cursor = String(json.cursor ?? json.next_cursor ?? '');
  if (!cursor) break;
  await sleep(300);
}
if (all.length === 0) {
  console.error('未拉到任何文章：检查用户ID是否正确；若接口要求登录态，设置 JUEJIN_COOKIE 后重试');
  process.exit(1);
}

// ---------- 2. 逐篇拉取正文 ----------
mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
const targets = all.slice(0, limit);
for (const [i, info] of targets.entries()) {
  const id = String(info.article_id);
  const title = info.article_title ?? '(无标题)';
  try {
    const json = await post('/article/detail', { article_id: id });
    const a = json.data?.article_info ?? {};
    const tags = (json.data?.tags ?? []).map((t) => t.tag_name).filter(Boolean);
    const juejinCategory = json.data?.category?.category_name ?? '';
    const meta = {
      id,
      title: a.article_title ?? title,
      pubDate: fmtDate(a.ctime ?? info.ctime),
      views: a.view_count ?? 0,
      likes: a.like_count ?? 0,
      comments: a.comment_count ?? 0,
      collects: a.collect_count ?? 0,
      juejinCategory,
      tags,
    };
    const fm = [
      '---',
      `title: ${JSON.stringify(meta.title)}`,
      `pubDate: ${meta.pubDate}`,
      'category: ""  # 待归类: backend | practice | ai | career',
      `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
      'summary: ""',
      'draft: true',
      'juejin:',
      `  id: "${id}"`,
      `  views: ${meta.views}`,
      `  likes: ${meta.likes}`,
      '---',
      '',
    ].join('\n');
    const body = a.mark_content ?? '(正文为空：可能需要设置 JUEJIN_COOKIE 登录态)';
    writeFileSync(join(OUT_DIR, `${id}.md`), fm + body + '\n', 'utf8');
    manifest.push(meta);
    console.log(`[${i + 1}/${targets.length}] ${meta.title}`);
  } catch (err) {
    console.error(`[${i + 1}/${targets.length}] 失败: ${title} -> ${err.message}`);
    manifest.push({ id, title, error: err.message });
  }
  await sleep(400);
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
const failed = manifest.filter((m) => m.error).length;
console.log(`\n完成: 成功 ${manifest.length - failed} / ${manifest.length}，输出目录 ${OUT_DIR}`);
if (failed) console.log(`${failed} 篇失败，明细见 manifest.json 中带 error 字段的条目`);
