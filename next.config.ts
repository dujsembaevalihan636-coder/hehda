import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `npm run dev:https` в зале без интернета: телефоны открывают ноутбук по IP локальной сети
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'],
};

export default nextConfig;
