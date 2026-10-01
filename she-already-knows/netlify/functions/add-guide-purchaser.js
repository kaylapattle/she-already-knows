// Called by Zapier (Stan Store purchase -> Webhooks by Zapier -> here) to add
// a guide buyer's email to the guide_purchasers list instantly, instead of
// Kayla sending a manual batch. Secured with a shared secret header, since
// this endpoint has no user auth — anyone who knows the URL could otherwise
// grant themselves a free 30-day trial.
//
// Zapier setup: POST this URL with header "X-Webhook-Secret: <the secret>"
// and a JSON body of {"email": "<mapped from the Stan Store trigger>"}.

const { json, preflight, getSupabase, normEmail } = require("./lib/common");

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const expected = process.env.ZAPIER_WEBHOOK_SECRET;
  const provided = event.headers["x-webhook-secret"] || event.headers["X-Webhook-Secret"];
  if (!expected || !provided || provided !== expected) {
    return json(401, { error: "Invalid or missing webhook secret" });
  }

  try {
    const { email: rawEmail } = JSON.parse(event.body || "{}");
    const email = normEmail(rawEmail);
    if (!email || !email.includes("@")) return json(400, { error: "Valid email required" });

    const db = getSupabase();
    const { error } = await db.from("guide_purchasers").upsert({ email }, { onConflict: "email" });
    if (error) throw error;

    return json(200, { success: true, email });
  } catch (err) {
    console.error("add-guide-purchaser error:", err.message);
    return json(500, { error: err.message });
  }
};
