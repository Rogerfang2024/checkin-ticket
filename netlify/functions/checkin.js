export default async (req, context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, status: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const { GAS_API_URL, API_SECRET } = process.env;
    if (!GAS_API_URL || !API_SECRET) {
      return new Response(JSON.stringify({ ok: false, status: "server_misconfig", message: "伺服器未完成設定" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const phone = (body.phone ?? "").toString();
    const count = body.count;

    const r = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "checkin",
        phone,
        count,
        secret: API_SECRET,
      }),
    });

    const data = await r.json().catch(() => ({ ok: false, status: "bad_json" }));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, status: "function_error", message: "系統忙碌，請稍後再試" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
