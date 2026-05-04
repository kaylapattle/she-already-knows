exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body);

    if (!body || !body.messages) {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: "Missing messages" }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "API key not configured" }) };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: body.max_tokens || 1000,
        messages: body.messages
      })
    });

    const data = await response.json();
    return { statusCode: 200, headers: headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
