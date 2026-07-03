// Creates a Stripe Customer Portal session so a logged-in subscriber can manage
// or cancel their subscription, update their card, and view billing history.

const Stripe = require("stripe");
const { json, preflight, getSupabase, getAuthedEmail } = require("./lib/common");

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const email = await getAuthedEmail(event);
    if (!email) return json(401, { error: "Not authenticated" });

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return json(500, { error: "Stripe not configured" });
    const stripe = new Stripe(secret);

    const db = getSupabase();
    const { data: sub } = await db
      .from("subscribers").select("stripe_customer_id").eq("email", email).maybeSingle();
    if (!sub || !sub.stripe_customer_id) return json(400, { error: "No subscription found" });

    const origin = event.headers.origin || process.env.SITE_URL || process.env.URL || "";
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: origin || undefined,
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error("create-portal-session error:", err.message);
    return json(500, { error: err.message });
  }
};
