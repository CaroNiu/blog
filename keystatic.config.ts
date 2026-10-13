import { collection, config, fields } from '@keystatic/core';

/**
 * 内容后台（Keystatic 本地模式）配置
 * - 仅在 `npm run dev` 后访问 http://localhost:4321/keystatic 可用
 * - 编辑直接落盘到 src/content/posts/{category}/，之后照常 git 提交推送
 * - 字段与 src/content.config.ts 的 zod schema 保持一致，增改字段需同步两处
 * - juejin 字段（发布后回填/月度数据回收）不在后台管理，由脚本和 AI 维护
 */

const CATEGORY_OPTIONS = [
  { label: '后端进阶', value: 'backend' },
  { label: '实战复盘', value: 'practice' },
  { label: 'AI×程序员', value: 'ai' },
  { label: '职业思考', value: 'career' },
] as const;

const schemaFor = (category: (typeof CATEGORY_OPTIONS)[number]['value']) => ({
  title: fields.slug({
    name: { label: '标题' },
    slug: { label: 'URL slug（英文短横线命名）' },
    validation: { slug: { pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } },
  }),
  pubDate: fields.date({ label: '发布日期' }),
  category: fields.select({
    label: '分类',
    options: CATEGORY_OPTIONS,
    defaultValue: category,
  }),
  series: fields.text({ label: '系列（可选，如：支付与一致性）' }),
  tags: fields.array(fields.text({ label: '标签' }), {
    label: '标签',
    itemLabel: (props) => props.value || '新标签',
  }),
  summary: fields.text({ label: '摘要（列表页与 SEO 用）', multiline: true }),
  draft: fields.checkbox({ label: '草稿（true 不进站点构建）', defaultValue: false }),
  content: fields.markdoc({ label: '正文' }),
});

const collectionFor = (
  key: string,
  label: string,
  category: (typeof CATEGORY_OPTIONS)[number]['value'],
) =>
  collection({
    label,
    slugField: 'title',
    path: `src/content/posts/${key}/*`,
    format: { contentField: 'content' },
    schema: schemaFor(category),
  });

export default config({
  storage: { kind: 'local' },
  ui: {
    brand: { name: '后端不背锅 · 内容后台' },
    navigation: {
      内容: ['backend', 'practice', 'ai', 'career'],
    },
  },
  collections: {
    backend: collectionFor('backend', '后端进阶', 'backend'),
    practice: collectionFor('practice', '实战复盘', 'practice'),
    ai: collectionFor('ai', 'AI×程序员', 'ai'),
    career: collectionFor('career', '职业思考', 'career'),
  },
});
