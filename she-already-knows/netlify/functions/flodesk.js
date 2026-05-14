exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { email, firstName, segmentId, customFields } = JSON.parse(event.body);

    if (!email || !segmentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    const apiKey = process.env.FLODESK_API_KEY;
    const authHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Basic ${Buffer.from(apiKey + ":").toString("base64")}`
    };

    const subscriberRes = await fetch("https://api.flodesk.com/v1/subscribers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        email,
        first_name: firstName || "",
        segment_ids: [segmentId],
        ...(customFields ? { custom_fields: customFields } : {})
      })
    });

    if (!subscriberRes.ok) {
      const err = await subscriberRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: err }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error("Flodesk function error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
