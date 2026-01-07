// netlify/functions/checkin.js
// 用途：按下「確認入場」後，向 GAS 寫入核銷（Used + 入場人數 + 時間等）
// 一樣會把狀態碼/回應內容印在 Netlify log

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
    body: JSON.stringify(obj),
  };
}

function maskPhone(phone) {
  const p = String(phone || "").replace(/\D/g, "");
  if (p.length <= 3) return p;
  return `${"*".repeat(Math.max(0, p.length - 3))}${p.slice(-3)}`;
}

function safeSnippet(text, max = 300) {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max) + "..." : s;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, message: "Method not allowed" });
  }

  const reqId = event.headers["x-nf-request-id"] || "";
  const ip = event.headers["x-nf-client-connection-ip"] || "";
  const ua = event.headers["user-agent"] || "";
  console.log("[checkin] start", { reqId, ip, ua: ua.slice(0, 80) });

  const GAS_API_URL = process.env.GAS_API_URL;
  const API_SECRET = process.env.API_SECRET;

  console.log("[checkin] env", {
    hasGasUrl: !!GAS_API_URL,
    hasSecret: !!API_SECRET,
  });

  if (!GAS_API_URL) return json(500, { ok: false, message: "Server config missing: GAS_API_URL" });
  if (!API_SECRET) return json(500, { ok: false, message: "Server config missing: API_SECRET" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    console.log("[checkin] bad json body", { reqId, err: String(e) });
    return json(400, { ok: false, message: "Bad JSON" });
  }

  const rawPhone = String(body.phone ?? "");
  const digits = rawPhone.replace(/\D/g, "");
  const qty = Number(body.qty ?? 0);

  console.log("[checkin] input", {
    phoneMasked: maskPhone(digits),
    qty,
  });

  if (!digits) return json(400, { ok: false, message: "missing_phone" });
  if (!Number.isFinite(qty) || qty <= 0) return json(400, { ok: false, message: "invalid_qty" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const payload = {
    action: "checkin",
    phone: digits,
    qty,
    secret: API_SECRET,
  };

  console.log("[checkin] -> GAS request", {
    url: GAS_API_URL,
    payload: { action: payload.action, phoneMasked: maskPhone(digits), qty },
  });

  try {
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    clearTimeout(timeout);

    console.log("[checkin] <- GAS response", {
      status: res.status,
      ok: res.ok,
      textSnippet: safeSnippet(text, 400),
    });

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return json(502, { ok: false, message: "GAS_non_json", raw: safeSnippet(text, 800) });
    }

    return json(200, { ok: true, gas: data });

  } catch (err) {
    clearTimeout(timeout);
    const msg = String(err && err.message ? err.message : err);

    console.log("[checkin] ERROR", {
      reqId,
      err: msg,
      name: err && err.name ? err.name : "",
    });

    return json(504, { ok: false, message: "checkin_failed", detail: msg });
  }
};
