/**
 * GRAND AIR Cloudflare Worker API
 * Requires a D1 binding named DB and Worker secrets:
 *   ADMIN_PASSWORD  (set with: npx wrangler secret put ADMIN_PASSWORD)
 * Optional vars:
 *   ALLOWED_ORIGIN = exact website origin, e.g. https://grand-air.example
 *
 * Do not put the admin password in this file or commit it to GitHub.
 */
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}
function cleanText(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function intValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}
async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new Error("CONTENT_TYPE");
  }
  const text = await request.text();
  if (text.length > 100_000) throw new Error("TOO_LARGE");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("BAD_JSON");
  }
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function validPhone(phone) {
  return /^[0-9+\s()-]{7,25}$/.test(phone);
}
function productInput(body) {
  const name = cleanText(body.name, 160);
  const description = cleanText(body.description, 4000);
  const brand = cleanText(body.brand, 100);
  const imageUrl = cleanText(body.image_url, 1000);
  const category = cleanText(body.category, 100);
  const price = Number(body.price);
  const stock = intValue(body.stock, -1);
  if (!name || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
    throw new Error("INVALID_PRODUCT");
  }
  if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) throw new Error("INVALID_IMAGE_URL");
  return { name, description, brand, image_url: imageUrl, category, price, stock,
    active: body.active === false ? 0 : 1 };
}
async function requireAdmin(request, env) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(header);
  if (!match) return null;
  const tokenHash = await sha256(match[1]);
  const row = await env.DB.prepare(
    "SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return row ? { tokenHash } : null;
}
function cors(request, env, response) {
  const origin = request.headers.get("origin");
  const allowed = env.ALLOWED_ORIGIN;
  if (!origin || !allowed || origin !== allowed) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowed);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  return new Response(response.body, { status: response.status, headers });
}
async function handle(request, env) {
  if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204 });
  if (method === "GET" && path === "/") {
    return json({
      ok: true, app: "GRAND AIR",
      message: "API online",
      endpoints: ["/api/products", "/api/orders", "/api/service-requests", "/api/admin/login"],
    });
  }

  if (method === "GET" && path === "/api/products") {
    const rows = await env.DB.prepare(
      "SELECT id, name, description, brand, image_url, category, price, stock FROM products WHERE active = 1 ORDER BY created_at DESC LIMIT 200"
    ).all();
    return json({ ok: true, products: rows.results || [] });
  }

  if (method === "POST" && path === "/api/admin/login") {
    if (!env.ADMIN_PASSWORD) return json({ ok: false, error: "ADMIN_PASSWORD secret is not configured" }, 503);
    let body;
    try { body = await readJson(request); } catch (e) {
      return json({ ok: false, error: e.message === "CONTENT_TYPE" ? "JSON required" : "Invalid request body" }, 400);
    }
    const username = cleanText(body.username, 80);
    const password = typeof body.password === "string" ? body.password : "";
    if (username !== "admin" || password.length < 1 || password.length > 256) {
      return json({ ok: false, error: "Invalid credentials" }, 401);
    }
    // Compare fixed-length digests rather than directly branching on the password.
    const [givenHash, expectedHash] = await Promise.all([sha256(password), sha256(env.ADMIN_PASSWORD)]);
    if (givenHash !== expectedHash) return json({ ok: false, error: "Invalid credentials" }, 401);

    const rawToken = token();
    const tokenHash = await sha256(rawToken);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now).run();
    await env.DB.prepare(
      "INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)"
    ).bind(tokenHash, now, now + 8 * 60 * 60).run();
    return json({ ok: true, token: rawToken, expires_in: 28800 });
  }

  if (path.startsWith("/api/admin/")) {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ ok: false, error: "Unauthorized" }, 401);

    if (method === "POST" && path === "/api/admin/logout") {
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(admin.tokenHash).run();
      return json({ ok: true });
    }
    if (method === "GET" && path === "/api/admin/products") {
      const rows = await env.DB.prepare(
        "SELECT id, name, description, brand, image_url, category, price, stock, active, created_at, updated_at FROM products ORDER BY created_at DESC LIMIT 500"
      ).all();
      return json({ ok: true, products: rows.results || [] });
    }
    if (method === "GET" && path === "/api/admin/orders") {
      const rows = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 300").all();
      return json({ ok: true, orders: rows.results || [] });
    }
    if (method === "PATCH" && /^\/api\/admin\/orders\/[1-9]\d*$/.test(path)) {
      let body;
      try { body = await readJson(request); } catch {
        return json({ ok: false, error: "Invalid JSON body" }, 400);
      }
      const status = cleanText(body.status, 30);
      const allowed = ["new", "confirmed", "preparing", "shipped", "completed", "cancelled"];
      if (!allowed.includes(status)) return json({ ok: false, error: "Invalid order status" }, 400);
      const id = Number(path.split("/").pop());
      const result = await env.DB.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status, new Date().toISOString(), id).run();
      if (!result.meta?.changes) return json({ ok: false, error: "Order not found" }, 404);
      return json({ ok: true });
    }
    if (method === "POST" && path === "/api/admin/products") {
      let body;
      try { body = await readJson(request); } catch {
        return json({ ok: false, error: "Invalid JSON body" }, 400);
      }
      let p;
      try { p = productInput(body); } catch (e) {
        return json({ ok: false, error: e.message }, 400);
      }
      const result = await env.DB.prepare(
        "INSERT INTO products (name, description, brand, image_url, category, price, stock, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(p.name, p.description, p.brand, p.image_url, p.category, p.price, p.stock, p.active,
        new Date().toISOString(), new Date().toISOString()).run();
      return json({ ok: true, id: result.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && /^\/api\/admin\/products\/[1-9]\d*$/.test(path)) {
      let body;
      try { body = await readJson(request); } catch {
        return json({ ok: false, error: "Invalid JSON body" }, 400);
      }
      let p;
      try { p = productInput(body); } catch (e) {
        return json({ ok: false, error: e.message }, 400);
      }
      const id = Number(path.split("/").pop());
      const result = await env.DB.prepare(
        "UPDATE products SET name=?, description=?, brand=?, image_url=?, category=?, price=?, stock=?, active=?, updated_at=? WHERE id=?"
      ).bind(p.name, p.description, p.brand, p.image_url, p.category, p.price, p.stock, p.active,
        new Date().toISOString(), id).run();
      if (!result.meta?.changes) return json({ ok: false, error: "Product not found" }, 404);
      return json({ ok: true });
    }
    if (method === "DELETE" && /^\/api\/admin\/products\/[1-9]\d*$/.test(path)) {
      const id = Number(path.split("/").pop());
      const result = await env.DB.prepare("UPDATE products SET active=0, updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), id).run();
      if (!result.meta?.changes) return json({ ok: false, error: "Product not found" }, 404);
      return json({ ok: true });
    }
    if (method === "GET" && path === "/api/admin/service-requests") {
      const rows = await env.DB.prepare("SELECT * FROM service_requests ORDER BY created_at DESC LIMIT 300").all();
      return json({ ok: true, requests: rows.results || [] });
    }
    if (method === "GET" && path === "/api/admin/summary") {
      const [products, orders, services] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS count FROM products WHERE active=1").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM service_requests").first(),
      ]);
      return json({ ok: true, products: products?.count || 0, orders: orders?.count || 0, service_requests: services?.count || 0 });
    }
    return json({ ok: false, error: "Admin endpoint not found" }, 404);
  }

  if (method === "POST" && path === "/api/orders") {
    let body;
    try { body = await readJson(request); } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }
    const customerName = cleanText(body.customer_name, 120);
    const phone = cleanText(body.phone, 25);
    const address = cleanText(body.address, 1000);
    const notes = cleanText(body.notes, 1000);
    const paymentMethod = cleanText(body.payment_method, 30);
    if (!customerName || !validPhone(phone) || !address || !Array.isArray(body.items) ||
        body.items.length < 1 || body.items.length > 30 || paymentMethod !== "cash_on_delivery") {
      return json({ ok: false, error: "Missing or invalid order information" }, 400);
    }
    // Prices and stock are always read from D1; client-supplied totals are ignored.
    const quantities = new Map();
    for (const item of body.items) {
      const id = intValue(item?.product_id, -1);
      const qty = Number(item?.quantity);
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 20) {
        return json({ ok: false, error: "Invalid order item" }, 400);
      }
      quantities.set(id, (quantities.get(id) || 0) + qty);
    }
    const items = [];
    let total = 0;
    for (const [id, qty] of quantities) {
      const product = await env.DB.prepare("SELECT id, name, price, stock FROM products WHERE id=? AND active=1").bind(id).first();
      if (!product || product.stock < qty) return json({ ok: false, error: "Product unavailable or insufficient stock", product_id: id }, 409);
      items.push({ product_id: id, name: product.name, price: product.price, quantity: qty });
      total += product.price * qty;
    }
    if (!Number.isSafeInteger(Math.round(total * 100)) || total < 0) return json({ ok: false, error: "Invalid order total" }, 400);
    const now = new Date().toISOString();
    const orderNumber = "GA-" + Date.now().toString(36).toUpperCase() + "-" + crypto.getRandomValues(new Uint8Array(3)).reduce((s,b)=>s+b.toString(16).padStart(2,"0"),"").toUpperCase();
    // D1 batch is transactional: stock updates and order creation commit together.
    // Guard each stock decrement in SQL so concurrent orders cannot oversell silently.
    const orderInsert = env.DB.prepare(
      "INSERT INTO orders (order_number, customer_name, phone, address, notes, payment_method, items_json, total, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)"
    ).bind(orderNumber, customerName, phone, address, notes, paymentMethod, JSON.stringify(items), total, now, now);
    const stockStatements = items.map((item) =>
      env.DB.prepare("UPDATE products SET stock = stock - ?, updated_at=? WHERE id=? AND active=1 AND stock >= ?")
        .bind(item.quantity, now, item.product_id, item.quantity)
    );
    const results = await env.DB.batch([...stockStatements, orderInsert]);
    const failedStockUpdate = results.slice(0, stockStatements.length).some((r) => !r.success || r.meta?.changes !== 1);
    if (failedStockUpdate) {
      // The D1 batch is atomic; a failed guarded update should not leave a partial order.
      return json({ ok: false, error: "Stock changed during checkout; please retry" }, 409);
    }
    const orderResult = results[results.length - 1];
    return json({ ok: true, order_id: orderResult.meta.last_row_id, order_number: orderNumber, total }, 201);
  }

  if (method === "POST" && path === "/api/service-requests") {
    let body;
    try { body = await readJson(request); } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }
    const customerName = cleanText(body.customer_name, 120);
    const phone = cleanText(body.phone, 25);
    const serviceType = cleanText(body.service_type, 80);
    const address = cleanText(body.address, 1000);
    const details = cleanText(body.details, 2000);
    if (!customerName || !validPhone(phone) || !serviceType || !address) {
      return json({ ok: false, error: "Name, valid phone, service type and address are required" }, 400);
    }
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      "INSERT INTO service_requests (customer_name, phone, service_type, address, details, status, created_at) VALUES (?, ?, ?, ?, ?, 'new', ?)"
    ).bind(customerName, phone, serviceType, address, details, now).run();
    return json({ ok: true, request_id: result.meta.last_row_id }, 201);
  }

  return json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const response = await handle(request, env);
      return cors(request, env, response);
    } catch (error) {
      // Do not leak database details, secrets, or stack traces to callers.
      console.error("GRAND AIR Worker request failed:", error?.message || "unknown error");
      return json({ ok: false, error: "Internal server error" }, 500);
    }
  },
};
