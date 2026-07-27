// Cancels a subscription through our own survey flow (reason + required
// feedback + follow-up consent) instead of Stripe's hosted portal, so every
// cancellation is captured. Cancels at period end — they keep access through
// what they already paid for.

const Stripe = require("stripe");
const { json, preflight, getSupabase, getAuthedEmail, addToFlodesk, removeFromFlodeskSegment } = require("./lib/common");

const SUBSCRIBERS_SEGMENT = "6a4d53b57abe5072c2a61df1"; // paid subscribers
// Flodesk segment for cancelled subscribers (set once Kayla creates it and sends the ID).
const CANCELLED_SEGMENT = process.env.FLODESK_CANCELLED_SEGMENT || null;

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const email = await getAuthedEmail(event);
    if (!email) return json(401, { error: "Not authenticated" });

    const { reason, feedback, followupOk, handle } = JSON.parse(event.body || "{}");
    if (!reason || !feedback || !feedback.trim()) {
      return json(400, { error: "Reason and feedback are required" });
    }

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return json(500, { error: "Stripe not configured" });
    const stripe = new Stripe(secret);

    const db = getSupabase();
    const { data: sub } = await db
      .from("subscribers").select("name, stripe_subscription_id").eq("email", email).maybeSingle();
    if (!sub || !sub.stripe_subscription_id) return json(400, { error: "No active subscription found" });

    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });

    await db.from("subscribers").update({
      cancel_reason: reason,
      cancel_feedback: feedback.trim(),
      cancel_followup_ok: !!followupOk,
      cancel_handle: handle || null,
    }).eq("email", email);

    const firstName = sub.name ? sub.name.split(" ")[0] : "";
    await removeFromFlodeskSegment(email, SUBSCRIBERS_SEGMENT);
    if (CANCELLED_SEGMENT) await addToFlodesk(email, firstName, CANCELLED_SEGMENT);

    return json(200, { success: true });
  } catch (err) {
    console.error("cancel-subscription error:", err.message);
    return json(500, { error: err.message });
  }
};
