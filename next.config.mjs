/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server actions revalidate paths correctly, but the App Router's client-
  // side navigation cache can still serve a page snapshot from up to 30s
  // ago on a soft nav (e.g. clicking a sidebar Link right after a toggle
  // on another page). Disabling that window keeps every page's data fresh
  // on navigation, which matters more here than the minor prefetch speedup.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
};
export default nextConfig;
