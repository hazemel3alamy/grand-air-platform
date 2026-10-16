# GRAND AIR Worker API (safe starter)

This folder is an API backend starter, not a claim that the live site is deployed.

## Before deployment
1. Verify `database_id` in `wrangler.toml` and replace the placeholder with the actual ID for `grand-air-db`.
2. Run `schema.sql` once on the intended D1 database.
3. Set the admin password as a Worker secret. Never add it to this repository:
   `npx wrangler secret put ADMIN_PASSWORD`
   Enter the admin password when prompted.
4. If the website is hosted on another origin, set `ALLOWED_ORIGIN` to that exact HTTPS origin.
5. Deploy only after reviewing the binding and target Worker name.

## API
- `GET /` health/info
- `GET /api/products` active products
- `POST /api/admin/login` JSON `{ "username": "admin", "password": "..." }`
- Admin endpoints require `Authorization: Bearer <token>`:
  - `POST /api/admin/logout`
  - `GET /api/admin/summary`
  - `GET /api/admin/products` (all products, including hidden)
  - `GET /api/admin/orders`
  - `PATCH /api/admin/orders/:id` JSON `{ "status": "confirmed" }`
  - `GET /api/admin/service-requests`
  - `POST /api/admin/products` (add an air conditioner/product)
  - `PATCH /api/admin/products/:id` (change details, image, price, stock, category, brand, visibility)
  - `DELETE /api/admin/products/:id` (hide product from storefront; data remains in D1)
- `POST /api/orders` accepts cash-on-delivery orders and ignores client-submitted prices.
- `POST /api/service-requests` records installation/maintenance requests.

## Important limitations
- This is not a full storefront UI or Android APK.
- Online card/wallet payments are not implemented.
- Review inventory race conditions and test all endpoints in a staging database before accepting real orders.
- Configure Cloudflare rate limiting/WAF for the login and public submission endpoints before production.


## Product fields
Admin product creation/update expects:
`name`, `description`, `brand`, `image_url` (HTTPS URL or empty), `category`, `price` (number >= 0), `stock` (integer >= 0), and optional `active` (false hides it).

The storefront product API returns active products only. The admin product API returns active and hidden products, so the manager can restore visibility by updating `active: true`.
