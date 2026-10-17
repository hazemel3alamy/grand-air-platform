
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { ok: false, error: "Database binding DB is missing" },
        { status: 500 }
      );
    }

    const body = await request.json();

    const name = String(body.name || "").trim().slice(0, 120);
    const phone = String(body.phone || "").trim().slice(0, 30);
    const type = String(body.type || "general").trim().slice(0, 80);
    const details = String(body.details || "").trim().slice(0, 2000);

    if (name.length < 2 || phone.length < 6) {
      return Response.json(
        { ok: false, error: "الاسم ورقم الهاتف مطلوبان" },
        { status: 400 }
      );
    }

    const result = await env.DB.prepare(
      `INSERT INTO service_requests
       (customer_name, phone, request_type, details)
       VALUES (?, ?, ?, ?)`
    )
      .bind(name, phone, type || "general", details)
      .run();

    if (!result.success) {
      throw new Error("Database insert failed");
    }

    return Response.json(
      { ok: true, id: result.meta?.last_row_id },
      { status: 201 }
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: "تعذر حفظ الطلب، حاول مرة أخرى" },
      { status: 500 }
    );
  }
}
