# Grand Air PWA

This is an installable, mobile-first PWA frontend. It must be hosted over HTTPS (Cloudflare Pages is suitable).

## Current behavior
- Responsive Arabic storefront, install prompt, manifest, service worker, offline shell.
- Contact and service request fallback through WhatsApp to the business number.
- Product catalog can use the existing Worker API after setting `API_BASE` in `app.js`.
- Without `API_BASE`, the page displays example service cards, not real stock or database products.

## Before launch
1. Deploy the `site/` folder to Cloudflare Pages or another HTTPS static host.
2. Configure `API_BASE` in `app.js` to the deployed Worker URL.
3. Set Worker `ALLOWED_ORIGIN` to the exact deployed site origin, and ensure its D1 database and `ADMIN_PASSWORD` secret are configured.
4. Test product listing and service-request submission on a phone. Then use the browser menu → Add to Home screen / Install app.

The PWA files are prepared but are not deployed yet. The backend also remains unconfigured until the real D1 ID and Worker URL are confirmed.
