/** @type {import('next').NextConfig} */

/**
 * Redirects for every URL the restructure moved.
 *
 * These are config-level on purpose: a config redirect sends a real Location
 * header, so bookmarks, link unfurlers and curl all land correctly. (A static
 * page calling permanentRedirect() ships a 308 with NO Location header, cached
 * for a year — a lesson this project has already learned once.)
 *
 * They are `permanent: false` while the restructure settles. A permanent
 * redirect is cached by browsers for a very long time and is painful to undo;
 * these can be promoted once the new URLs have been in place for a while.
 */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      /**
       * The front door goes to the Inbox — conversations are the centre of the
       * product.
       *
       * This is a CONFIG redirect, not a page calling redirect(). A statically
       * prerendered page that redirects ships a 307 with NO Location header
       * (the destination rides in the RSC payload), which browsers follow but
       * curl, link unfurlers and health checks do not. This repository has
       * already been bitten by that once, on the old tracker URL.
       */
      { source: "/", destination: "/inbox", permanent: false },

      // The product no longer has "departments" — it has things you do.
      { source: "/departments", destination: "/inbox", permanent: false },
      {
        source: "/departments/customers-sales",
        destination: "/customers",
        permanent: false,
      },
      {
        source: "/departments/installments-payments",
        destination: "/installments",
        permanent: false,
      },
      {
        source: "/departments/installments-payments/tracker",
        destination: "/installments",
        permanent: false,
      },
      {
        source: "/departments/garage-vehicles",
        destination: "/vehicles",
        permanent: false,
      },
      // Older slugs that already redirected once, kept working.
      {
        source: "/departments/garage-service",
        destination: "/vehicles",
        permanent: false,
      },
      {
        source: "/departments/vehicles-parts",
        destination: "/vehicles",
        permanent: false,
      },
      /**
       * Money & Reports had no successor SCREEN, by design: Monza AI does not
       * keep a second set of books. Money questions go to the assistant, which
       * reads the finance connector under the asker's own permissions.
       */
      { source: "/departments/money-reports", destination: "/chat", permanent: false },
      { source: "/departments/:slug*", destination: "/inbox", permanent: false },

      // WhatsApp is one channel of the product now, not a product of its own.
      { source: "/whatsapp-sales", destination: "/sales", permanent: false },
      { source: "/whatsapp-sales/:path*", destination: "/sales", permanent: false },

      // "Connections" became "Integrations" — channels as well as systems.
      { source: "/connections", destination: "/integrations", permanent: false },
    ];
  },
};

export default nextConfig;
