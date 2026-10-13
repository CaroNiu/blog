import { defineConfig } from 'astro/config';
import keystatic from '@keystatic/astro';

// 正式域名已绑定（影响 RSS/sitemap/SEO）
// keystatic 集成提供内容后台（/keystatic）：仅 dev 加载（storage: local 只在本地可写），
// 生产构建为纯静态，不需要服务端适配器
export default defineConfig({
  site: 'https://novasolo.online',
  language: 'zh-CN',
  integrations: [...(process.env.NODE_ENV === 'development' ? [keystatic()] : [])],
});
