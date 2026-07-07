// Shared helpers for the Phase 2 functions. Files under lib/ are NOT treated as
// function endpoints by Netlify — only top-level files in netlify/functions are.

const { createClient } = require("@supabase/supabase-js");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// Trial lengths (days). Beta members get the "first month free"; everyone else 7.
const TRIAL_DAYS = { beta: 30, new: 7 };

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function preflight(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  return null;
}

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

const normEmail = (e) => (e || "").trim().toLowerCase();

// Verify the Supabase Auth JWT from the Authorization header and return the
// authenticated user's email (lowercased), or null if missing/invalid. This is
// the source of identity for gated functions — never trust an email from the body.
async function getAuthedEmail(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  try {
    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data || !data.user || !data.user.email) return null;
    return normEmail(data.user.email);
  } catch (e) {
    return null;
  }
}

// Single source of truth for "can this person use the premium experience?"
// A subscriber row is the input; returns true/false.
function hasAccess(sub) {
  if (!sub) return false;
  if (sub.status === "active") return true;
  if (sub.status === "trialing" && sub.trial_end && new Date(sub.trial_end) > new Date()) return true;
  // past_due keeps access through Stripe's grace window if the period hasn't ended
  if (sub.status === "past_due" && sub.current_period_end && new Date(sub.current_period_end) > new Date()) return true;
  return false;
}

// Add/upsert a subscriber into a Flodesk segment (used to fire welcome emails
// when someone starts a paid subscription). Best-effort — never throws.
async function addToFlodesk(email, firstName, segmentId) {
  const apiKey = process.env.FLODESK_API_KEY;
  if (!apiKey || !email || !segmentId) return;
  try {
    const auth = "Basic " + Buffer.from(apiKey + ":").toString("base64");
    await fetch("https://api.flodesk.com/v1/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": auth },
      body: JSON.stringify({ email, first_name: firstName || "", segment_ids: [segmentId] }),
    });
  } catch (e) {
    console.error("addToFlodesk error:", e.message);
  }
}

module.exports = { CORS, TRIAL_DAYS, json, preflight, getSupabase, normEmail, hasAccess, getAuthedEmail, addToFlodesk };
