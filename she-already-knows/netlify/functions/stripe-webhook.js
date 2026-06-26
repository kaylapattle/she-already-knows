// Stripe webhook → keeps Supabase in sync with subscription state.
// Configure the endpoint in Stripe (Developers → Webhooks) pointing at:
//   https://<your-site>/.netlify/functions/stripe-webhook
// and put the signing secret in STRIPE_WEBHOOK_SECRET.

const Stripe = require("stripe");
const { getSupabase, normEmail } = require("./lib/common");

// Map Stripe's subscription.status to our smaller enum.
function mapStatus(s) {
  if (s === "active") return "active";
  if (s === "trialing") return "trialing";
  if (s === "past_due") return "past_due";
  return "canceled"; // canceled | unpaid | incomplete_expired
}

async function upsertFromSubscription(db, sub, emailHint) {
  const email = normEmail(emailHint || (sub.metadata && sub.metadata.email));
  const row = {
    status: mapStatus(sub.status),
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString() : null,
  };
  if (email) row.email = email;

  if (email) {
    await db.from("subscribers").upsert(row, { onConflict: "email" });
  } else {
    // No email on the event — match the existing row by customer id.
    await db.from("subscribers").update(row).eq("stripe_customer_id", sub.customer);
  }
}

exports.handler = async function (event) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) return { statusCode: 500, body: "Stripe not configured" };
  const stripe = new Stripe(secret);

  const sig = event.headers["stripe-signature"];
  const payload = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(payload, sig, whSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    const db = getSupabase();
    const obj = stripeEvent.data.object;

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const email = obj.client_reference_id || (obj.customer_details && obj.customer_details.email);
        if (obj.subscription) {
          const sub = await stripe.subscriptions.retrieve(obj.subscription);
          await upsertFromSubscription(db, sub, email);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertFromSubscription(db, obj);
        break;
      }
      case "invoice.payment_failed": {
        if (obj.customer) {
          await db.from("subscribers")
            .update({ status: "past_due" }).eq("stripe_customer_id", obj.customer);
        }
        break;
      }
      default:
        break; // ignore everything else
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error("stripe-webhook handler error:", err.message);
    return { statusCode: 500, body: `Handler Error: ${err.message}` };
  }
};
