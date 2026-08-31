/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        // The tracker moved up a level and IS the department page now.
        // A config-level redirect sends a real Location header, so curl,
        // link unfurlers and bookmarks all land correctly.
        source: "/departments/installments-payments/tracker",
        destination: "/departments/installments-payments",
        permanent: true,
      },
    ];
  },
};
export default nextConfig;
