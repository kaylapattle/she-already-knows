// Authenticated CRUD for journal_entries + journal_entry_versions.
// All calls are POST with an { action } discriminator so apiPost() works for all.

const { json, preflight, getSupabase, getAuthedEmail } = require("./lib/common");

exports.handler = async function (event) {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const email = await getAuthedEmail(event);
  if (!email) return json(401, { error: "Not authenticated" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }

  const { action } = body;
  const db = getSupabase();

  // ── list — all non-deleted entries newest-first with their version history ─────
  if (action === "list") {
    const { data: entries, error } = await db
      .from("journal_entries")
      .select("id, situation, feeling, ai_response, ai_response_v2, body, created_at, updated_at, journal_entry_versions(id, saved_at, body, source)")
      .eq("user_email", email)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) return json(500, { error: error.message });
    const result = (entries || []).map(e => ({
      ...e,
      journal_entry_versions: (e.journal_entry_versions || []).sort(
        (a, b) => new Date(b.saved_at) - new Date(a.saved_at)
      ),
    }));
    return json(200, { entries: result });
  }

  // ── save — create a new entry + initial version row ───────────────────────────
  if (action === "save") {
    const { situation, feeling, ai_response, entry_body, source } = body;
    const { data: entry, error: eErr } = await db
      .from("journal_entries")
      .insert({
        user_email: email,
        situation: situation || null,
        feeling: feeling || null,
        ai_response: ai_response || null,
        body: entry_body || "",
      })
      .select()
      .single();
    if (eErr) return json(500, { error: eErr.message });
    if (entry_body) {
      await db.from("journal_entry_versions").insert({
        entry_id: entry.id,
        body: entry_body,
        source: source || "auto",
      });
    }
    return json(200, { entry });
  }

  // ── update — rewrite body and append a version row (old body is never lost) ───
  if (action === "update") {
    const { entry_id, entry_body, ai_response_v2, source } = body;
    if (!entry_id) return json(400, { error: "entry_id required" });
    // Ownership check
    const { data: existing } = await db
      .from("journal_entries")
      .select("id")
      .eq("id", entry_id)
      .eq("user_email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (!existing) return json(404, { error: "Entry not found" });
    const updates = {};
    if (entry_body !== undefined) updates.body = entry_body;
    if (ai_response_v2 !== undefined) updates.ai_response_v2 = ai_response_v2;
    if (Object.keys(updates).length === 0) return json(400, { error: "Nothing to update" });
    const { error: uErr } = await db
      .from("journal_entries")
      .update(updates)
      .eq("id", entry_id);
    if (uErr) return json(500, { error: uErr.message });
    // Only create a version row when the user's reflection text changed
    let version = null;
    if (entry_body !== undefined) {
      const { data: v } = await db
        .from("journal_entry_versions")
        .insert({ entry_id, body: entry_body, source: source || "manual" })
        .select()
        .single();
      version = v;
    }
    return json(200, { ok: true, version });
  }

  // ── delete — soft-delete so the row stays in the DB ──────────────────────────
  if (action === "delete") {
    const { entry_id } = body;
    if (!entry_id) return json(400, { error: "entry_id required" });
    const { error: dErr } = await db
      .from("journal_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", entry_id)
      .eq("user_email", email);
    if (dErr) return json(500, { error: dErr.message });
    return json(200, { ok: true });
  }

  // ── memory — compact recent-entry summary for injecting into Claude prompts ───
  if (action === "memory") {
    const lim = Math.min(body.limit || 5, 10);
    const { data: entries, error: mErr } = await db
      .from("journal_entries")
      .select("situation, feeling, ai_response, body, created_at")
      .eq("user_email", email)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(lim);
    if (mErr) return json(500, { error: mErr.message });
    return json(200, { entries: entries || [] });
  }

  return json(400, { error: "Unknown action" });
};
