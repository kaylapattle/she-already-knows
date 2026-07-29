// Saves the founding-member prompt response shown right after checkout.
// Called by an authenticated (logged-in) user only.

const { json, preflight, getSupabase, getAuthedEmail, addToFlodesk } = require("./lib/common");

// Flodesk segment for founding members (set once Kayla creates it and sends the ID).
const FOUNDING_SEGMENT = process.env.FLODESK_FOUNDING_SEGMENT || null;

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const email = await getAuthedEmail(event);
    if (!email) return json(401, { error: "Not authenticated" });

    const { response, handle } = JSON.parse(event.body || "{}");
    if (response !== "yes" && response !== "maybe_later") {
      return json(400, { error: "Invalid response" });
    }

    const db = getSupabase();
    const { data: sub } = await db
      .from("subscribers")
      .update({ founding_member_status: response, founding_member_handle: handle || null })
      .eq("email", email)
      .select("name")
      .maybeSingle();

    if (response === "yes" && FOUNDING_SEGMENT) {
      const firstName = sub && sub.name ? sub.name.split(" ")[0] : "";
      await addToFlodesk(email, firstName, FOUNDING_SEGMENT);
    }

    return json(200, { success: true });
  } catch (err) {
    console.error("save-founding-member error:", err.message);
    return json(500, { error: err.message });
  }
};
