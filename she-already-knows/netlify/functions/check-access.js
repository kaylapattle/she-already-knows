// Returns whether an email currently has access (active sub or live trial).
// The frontend calls this before letting someone into the premium V2 flow.
//
// Also where guide-purchaser (Stan Store) handling lives: if this email is on
// the guide_purchasers list and hasn't been processed yet (is_guide_purchaser
// still false), grant/extend a 30-day no-card trial. This block only ever
// runs ONCE per person — every code path below checks is_guide_purchaser
// first and does nothing if it's already true, so re-checking access on every
// page load never re-extends a trial or re-fires the Flodesk tag.

const Stripe = require("stripe");
const { json, preflight, getSupabase, hasAccess, getAuthedEmail, addToFlodesk, TRIAL_DAYS } = require("./lib/common");

const GUIDE_TRIAL_DAYS = 30;
const GUIDE_SEGMENT = "6ab1abd29d65d17a82847dfb"; // Flodesk "guide purchasers"

async function isGuidePurchaser(db, email) {
  const { data } = await db.from("guide_purchasers").select("email").eq("email", email).maybeSingle();
  return !!data;
}

async function extendStripeTrial(subscriptionId, trialEndUnix) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !subscriptionId) return;
  const stripe = new Stripe(secret);
  await stripe.subscriptions.update(subscriptionId, { trial_end: trialEndUnix, proration_behavior: "none" });
}

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const email = await getAuthedEmail(event);
    if (!email) return json(401, { error: "Not authenticated" });

    const db = getSupabase();
    let { data: sub, error } = await db
      .from("subscribers").select("*").eq("email", email).maybeSingle();
    if (error) throw error;

    if (!sub) {
      // First-timer. Check the guide list before falling back to the normal
      // card-upfront trial info.
      if (await isGuidePurchaser(db, email)) {
        const trialEnd = new Date(Date.now() + GUIDE_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data: created, error: insErr } = await db
          .from("subscribers")
          .insert({ email, status: "trialing", trial_end: trialEnd, is_guide_purchaser: true })
          .select().single();
        if (insErr) throw insErr;
        await addToFlodesk(email, "", GUIDE_SEGMENT);
        return json(200, {
          access: true, status: "trialing", trialEnd: created.trial_end,
          isGuidePurchaser: true, trialDays: GUIDE_TRIAL_DAYS, hadSubscription: false, known: true,
        });
      }

      const { data: beta } = await db
        .from("beta_emails").select("email").eq("email", email).maybeSingle();
      const isBeta = !!beta;
      return json(200, {
        access: false, status: "none", known: false,
        isBeta, trialDays: isBeta ? TRIAL_DAYS.beta : TRIAL_DAYS.new,
        hadSubscription: false,
      });
    }

    // Existing row, not yet processed as a guide purchaser — check once.
    if (!sub.is_guide_purchaser && await isGuidePurchaser(db, email)) {
      const updates = { is_guide_purchaser: true };

      // Only extend the trial for someone CURRENTLY mid-trial. Paying/past_due/
      // canceled subscribers are just tagged — no billing changes.
      if (sub.status === "trialing") {
        const trialEndDate = new Date(Date.now() + GUIDE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
        updates.trial_end = trialEndDate.toISOString();
        if (sub.stripe_subscription_id) {
          await extendStripeTrial(sub.stripe_subscription_id, Math.floor(trialEndDate.getTime() / 1000));
        }
      }

      const { data: updated, error: updErr } = await db
        .from("subscribers").update(updates).eq("email", email).select().single();
      if (updErr) throw updErr;
      sub = updated;
      await addToFlodesk(email, sub.name || "", GUIDE_SEGMENT);
    }

    return json(200, {
      access: hasAccess(sub),
      status: sub.status,
      trialEnd: sub.trial_end,
      currentPeriodEnd: sub.current_period_end,
      isBeta: sub.is_beta,
      isGuidePurchaser: sub.is_guide_purchaser,
      trialDays: sub.is_guide_purchaser ? GUIDE_TRIAL_DAYS : (sub.is_beta ? TRIAL_DAYS.beta : TRIAL_DAYS.new),
      // A lapsed guide purchaser already had their free period even without a
      // Stripe subscription (it was card-less) — treat them as "returning" too,
      // so the paywall doesn't promise a second free trial it won't grant.
      hadSubscription: !!sub.stripe_subscription_id || !!sub.is_guide_purchaser,
      known: true,
    });
  } catch (err) {
    console.error("check-access error:", err.message);
    return json(500, { error: err.message });
  }
};
