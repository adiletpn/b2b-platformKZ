import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Playwright запускает браузер из node_modules: бандлить его нельзя.
  serverExternalPackages: ['playwright', 'playwright-core'],
  // Фото товаров приходят ссылками из каталога поставщика.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // Переход между вкладками без ожидания: открытые страницы живут в кэше браузера 30 с.
  experimental: { staleTimes: { dynamic: 30, static: 180 } },
};

export default withNextIntl(nextConfig);
