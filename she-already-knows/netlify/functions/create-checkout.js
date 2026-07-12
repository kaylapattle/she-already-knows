// Creates a Stripe Checkout session for the $7.99/mo subscription with a free
// trial. Card is collected up front; $0 today; first charge on the day the
// trial ends. Beta members get 30 days, everyone else 7.

const Stripe = require("stripe");
const { json, preflight, getSupabase, getAuthedEmail, TRIAL_DAYS } = require("./lib/common");

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const email = await getAuthedEmail(event);
    if (!email) return json(401, { error: "Not authenticated" });
    const { name } = JSON.parse(event.body || "{}");

    const secret = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!secret || !priceId) return json(500, { error: "Stripe not configured" });
    const stripe = new Stripe(secret);

    const db = getSupabase();
    const { data: sub } = await db
      .from("subscribers").select("*").eq("email", email).maybeSingle();

    // A person who already has (or had) a subscription should not start a second
    // free trial. Only first-timers get the trial period.
    const { data: beta } = await db
      .from("beta_emails").select("email").eq("email", email).maybeSingle();
    const isBeta = sub ? sub.is_beta : !!beta;

    // Reuse the stored Stripe customer only if it actually exists in the CURRENT
    // Stripe mode — test and live share this Supabase, so a stored id may be from
    // the other mode (which would break checkout). If it's stale, start fresh.
    let customerId = sub && sub.stripe_customer_id;
    let validStored = false;
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        validStored = !existing.deleted;
      } catch (e) { validStored = false; }
    }
    if (!validStored) customerId = null;

    // Only skip the free trial if they have a VALID prior subscription in this mode.
    const hadSubscription = validStored && !!(sub && sub.stripe_subscription_id);
    const trialDays = hadSubscription ? 0 : (isBeta ? TRIAL_DAYS.beta : TRIAL_DAYS.new);

    if (!customerId) {
      const customer = await stripe.customers.create({ email, name: name || undefined, metadata: { email } });
      customerId = customer.id;
    }
    await db.from("subscribers")
      .upsert({ email, name: name || (sub && sub.name) || null, is_beta: isBeta, stripe_customer_id: customerId }, { onConflict: "email" });

    const origin = event.headers.origin || process.env.SITE_URL || process.env.URL || "";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // Require customers to accept the Terms of Service (URL configured in
      // Stripe → Settings → Checkout) before subscribing.
      consent_collection: { terms_of_service: "required" },
      // Collect the card even though today's charge is $0, so billing converts
      // automatically when the trial ends.
      payment_method_collection: "always",
      subscription_data: {
        metadata: { email },
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error("create-checkout error:", err.message);
    return json(500, { error: err.message });
  }
};
