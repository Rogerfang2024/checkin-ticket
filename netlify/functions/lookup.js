// netlify/functions/lookup.js
// 用途：前端輸入手機後，向 GAS 查詢是否有報名資料（以及可入場人數等）
// 你會在 Netlify Function log 看到：是否讀到環境變數、送出什麼、GAS 回什麼、狀態碼多少

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
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, message: "Method not allowed" });
  }

  const reqId = event.headers["x-nf-request-id"] || "";
  const ip = event.headers["x-nf-client-connection-ip"] || "";
  const ua = event.headers["user-agent"] || "";

  console.log("[lookup] start", { reqId, ip, ua: ua.slice(0, 80) });

  // 讀環境變數（不要印出 secret 本體）
  const GAS_API_URL = process.env.GAS_API_URL;
  const API_SECRET = process.env.API_SECRET;

  console.log("[lookup] env", {
    hasGasUrl: !!GAS_API_URL,
    hasSecret: !!API_SECRET,
  });

  if (!GAS_API_URL) return json(500, { ok: false, message: "Server config missing: GAS_API_URL" });
  if (!API_SECRET) return json(500, { ok: false, message: "Server config missing: API_SECRET" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    console.log("[lookup] bad json body", { reqId, err: String(e) });
    return json(400, { ok: false, message: "Bad JSON" });
  }

  // phone：允許輸入有無 0、含空白或破折號，這裡統一轉成純數字
  const rawPhone = String(body.phone ?? "");
  const digits = rawPhone.replace(/\D/g, ""); // 只留數字
  console.log("[lookup] input", { rawPhone: safeSnippet(rawPhone, 40), digitsMasked: maskPhone(digits), len: digits.length });

  if (!digits) {
    // 不要在「輸入途中」就報錯，你的前端應該只在送出時才呼叫 lookup
    return json(200, { ok: false, message: "empty_phone" });
  }

  // 超時控制（避免一直卡住）
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const payload = {
    action: "lookup",
    phone: digits,
    secret: API_SECRET,
  };

  console.log("[lookup] -> GAS request", {
    url: GAS_API_URL,
    payload: { action: payload.action, phoneMasked: maskPhone(digits) },
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

    console.log("[lookup] <- GAS response", {
      status: res.status,
      ok: res.ok,
      textSnippet: safeSnippet(text, 400),
    });

    // 嘗試 parse JSON
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      // 不是 JSON 也沒關係，我們把原文回傳方便你抓原因
      return json(502, { ok: false, message: "GAS_non_json", raw: safeSnippet(text, 800) });
    }

    // 這裡把 GAS 的回應原封不動帶回前端（但包一層 ok）
    // 建議 GAS 回：{ok:true, found:true/false, ...} or {ok:false, message:"..."}
    return json(200, { ok: true, gas: data });

  } catch (err) {
    clearTimeout(timeout);
    const msg = String(err && err.message ? err.message : err);

    console.log("[lookup] ERROR", {
      reqId,
      err: msg,
      name: err && err.name ? err.name : "",
    });

    // 常見：AbortError (超時)、TypeError (fetch 失敗)
    return json(504, { ok: false, message: "lookup_failed", detail: msg });
  }
};
