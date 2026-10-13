#!/usr/bin/env node
/**
 * 把 _inbox/ 里导出的掘金文章归类落位到 src/content/posts/{category}/
 * - 按 MAPPING 表写入 category / series / slug，draft 转 false
 * - 重复文章（SKIP 集合）留在 _inbox 不动
 * 用法: node tools/organize-inbox.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const INBOX = join(ROOT, '_inbox');
const POSTS = join(ROOT, 'src', 'content', 'posts');

// 挖金重复发的旧版（保留阅读数更高的 7621008107690754084）
const SKIP = new Set(['7619905636344873001']);

// id -> [分类, slug, 系列?]
const MAPPING = {
  // ---- career 职业思考 ----
  '7617564617016361014': ['career', 'ai-era-career-competitiveness'],
  '7618488988974825535': ['career', 'involution-era-competitiveness'],
  '7617689796781899830': ['career', 'coding-skill-vs-career-skill'],
  // ---- ai AI×程序员 ----
  '7616994432275202091': ['ai', 'ai-coding-productivity-300'],
  '7620864119612653610': ['ai', 'llm-app-prompt-to-rag'],
  // ---- practice 实战复盘 ----
  '7628488008481751083': ['practice', 'kafka-practice-summary'],
  '7626551706944536619': ['practice', 'api-debounce-request-dedup'],
  '7625992318693867562': ['practice', 'high-cpu-alert-diagnosis', '稳定性与可观测'],
  '7625563529491513386': ['practice', 'deep-pagination-optimization'],
  '7624024070773112868': ['practice', 'distributed-tx-selection', '支付与一致性'],
  '7623747758766964779': ['practice', 'design-patterns-in-business'],
  '7623270958960558116': ['practice', 'redis-local-cache', '高并发库存与缓存'],
  '7623087139460628534': ['practice', 'legacy-db-switch'],
  '7621784210572050473': ['practice', 'payment-callback-idempotency', '支付与一致性'],
  '7621444361259991046': ['practice', 'points-system-design'],
  '7621381446864748563': ['practice', 'inventory-deduction-approaches', '高并发库存与缓存'],
  '7621008107690803236': ['practice', 'order-timeout-cancel-evolution', '支付与一致性'],
  '7621008107690786852': ['practice', 'mongodb-shard-key-mistake'],
  '7621008107690754084': ['practice', 'nginx-lb-algorithm-tuning'],
  // ---- backend 后端进阶 ----
  '7616624197225431076': ['backend', 'backend-starter-first-api'],
  '7616631448961564726': ['backend', 'essential-linux-commands'],
  '7616631448961744950': ['backend', 'mysql-index-principles'],
  '7617277037111246891': ['backend', 'cache-penetration-breakdown-avalanche', '高并发库存与缓存'],
  '7617277037111279659': ['backend', 'docker-practical-intro'],
  '7617769259800002602': ['backend', 'when-to-use-microservices'],
  '7617769259800018986': ['backend', 'mq-selection-comparison'],
  '7618098747672100918': ['backend', 'distributed-lock-5-implementations', '高并发库存与缓存'],
  '7618100460149227539': ['backend', 'backend-perf-100ms-to-10ms', '稳定性与可观测'],
  '7618131518842011690': ['backend', 'kubernetes-core-concepts'],
  '7618236045017579556': ['backend', 'high-concurrency-from-zero'],
  '7618492703295127606': ['backend', 'api-design-7-best-practices'],
  '7618795660520308790': ['backend', 'jvm-memory-gc-tuning'],
  '7618852263628931135': ['backend', 'seckill-architecture', '高并发库存与缓存'],
  '7618852263628947519': ['backend', 'distributed-tx-2pc-3pc-tcc-saga', '支付与一致性'],
  '7619709755054686249': ['backend', 'db-sharding-when-how'],
  '7619919993262899236': ['backend', 'istio-service-mesh'],
  '7620324078792458281': ['backend', 'backend-security-defense'],
  '7620339315886391302': ['backend', 'event-driven-architecture'],
  '7620369623636213796': ['backend', 'api-gateway-selection'],
  '7620826561294778411': ['backend', 'observability-logs-metrics-tracing', '稳定性与可观测'],
  '7620826561294794795': ['backend', 'serverless-when-how'],
  '7622069365057011754': ['backend', 'elasticsearch-to-production'],
  '7622973948289515539': ['backend', 'external-api-design-guide'],
};

let moved = 0;
const missing = [];

for (const [id, [cat, slug, series]] of Object.entries(MAPPING)) {
  const src = join(INBOX, `${id}.md`);
  if (!existsSync(src)) {
    missing.push(id);
    continue;
  }
  const raw = readFileSync(src, 'utf8');
  const end = raw.indexOf('---', 3);
  if (!raw.startsWith('---') || end === -1) {
    console.error(`frontmatter 异常，跳过: ${id}`);
    continue;
  }
  let fm = raw.slice(0, end);
  const body = raw.slice(end);

  fm = fm.replace(/^category: .*$/m, `category: ${cat}`);
  if (series && !/^series:/m.test(fm)) {
    fm = fm.replace(/^(category: .*)$/m, `$1\nseries: ${series}`);
  }
  fm = fm.replace(/^draft: true$/m, 'draft: false');

  const dir = join(POSTS, cat);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), fm + body.replace(/^\n*/, '\n'), 'utf8');
  moved++;
}

console.log(`落位完成: ${moved} 篇`);
if (SKIP.size) console.log(`跳过重复: ${[...SKIP].join(', ')}`);
if (missing.length) console.log(`源文件缺失: ${missing.join(', ')}`);
