// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// The mount path is where Webflow Cloud serves this app on your site.
// It MUST match the "Mount path" you set in the Webflow Cloud dashboard.
// Everything the app exposes lives under it:
//   page:   https://<your-domain>/tools/sales-tax-calculator/
//   api:    https://<your-domain>/tools/sales-tax-calculator/api/quote
//   widget: https://<your-domain>/tools/sales-tax-calculator/widget.js
const MOUNT_PATH = '/tools/sales-tax-calculator';

export default defineConfig({
  base: MOUNT_PATH,
  output: 'server',
  adapter: cloudflare({
    // Gives `Astro.locals.runtime.env` (incl. secrets from .dev.vars) during `astro dev`.
    platformProxy: { enabled: true },
  }),
  build: {
    assetsPrefix: MOUNT_PATH,
  },
});
