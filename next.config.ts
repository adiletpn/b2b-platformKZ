import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Playwright запускает браузер из node_modules: бандлить его нельзя.
  serverExternalPackages: ['playwright', 'playwright-core'],
  // Фото товаров приходят ссылками из каталога поставщика.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

export default withNextIntl(nextConfig);
