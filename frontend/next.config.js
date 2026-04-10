/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'logo.clearbit.com' },
      { protocol: 'https', hostname: 'img.logo.dev' },
      { protocol: 'https', hostname: 'www.google.com' },
    ],
  },
};

module.exports = nextConfig;
