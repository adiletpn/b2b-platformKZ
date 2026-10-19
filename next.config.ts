import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Playwright запускает браузер из node_modules: бандлить его нельзя.
  serverExternalPackages: ['playwright', 'playwright-core'],
};

export default withNextIntl(nextConfig);
