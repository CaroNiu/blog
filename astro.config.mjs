import { defineConfig } from 'astro/config';

// 部署后把 site 换成正式域名（影响 RSS/sitemap/SEO）
export default defineConfig({
  site: 'https://example.com',
  language: 'zh-CN',
});
