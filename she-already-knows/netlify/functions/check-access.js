// Returns whether an email currently has access (active sub or live trial).
// The frontend calls this before letting someone into the premium V2 flow.

const { json, preflight, getSupabase, normEmail, hasAccess, TRIAL_DAYS } = require("./lib/common");

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const { email: rawEmail } = JSON.parse(event.body || "{}");
    const email = normEmail(rawEmail);
    if (!email || !email.includes("@")) return json(400, { error: "Valid email required" });

    const db = getSupabase();
    const { data: sub, error } = await db
      .from("subscribers").select("*").eq("email", email).maybeSingle();
    if (error) throw error;

    if (!sub) {
      // First-timer: tell the UI how long their trial would be.
      const { data: beta } = await db
        .from("beta_emails").select("email").eq("email", email).maybeSingle();
      const isBeta = !!beta;
      return json(200, {
        access: false, status: "none", known: false,
        isBeta, trialDays: isBeta ? TRIAL_DAYS.beta : TRIAL_DAYS.new,
        hadSubscription: false,
      });
    }

    return json(200, {
      access: hasAccess(sub),
      status: sub.status,
      trialEnd: sub.trial_end,
      currentPeriodEnd: sub.current_period_end,
      isBeta: sub.is_beta,
      trialDays: sub.is_beta ? TRIAL_DAYS.beta : TRIAL_DAYS.new,
      hadSubscription: !!sub.stripe_subscription_id,
      known: true,
    });
  } catch (err) {
    console.error("check-access error:", err.message);
    return json(500, { error: err.message });
  }
};
