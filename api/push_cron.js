// api/push_cron.js
import jwt from "jsonwebtoken";
import { connect } from "http2";

// No bodyParser needed for GET cron jobs
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  // Allow GET for cron, POST for manual testing
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Use GET (cron) or POST" });
  }

  // For POST, allow overriding token via body; for GET, use env var
  let body = {};
  try {
    if (req.body && typeof req.body === "string") {
      body = JSON.parse(req.body);
    } else if (req.body) {
      body = req.body;
    }
  } catch {
    // ignore parse errors
  }
  const token = body.token || process.env.APNS_DEVICE_TOKEN;
  if (!token) {
    return res
      .status(400)
      .json({ error: "Missing device token (body.token or APNS_DEVICE_TOKEN)" });
  }

  try {
    const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n");
    const teamId = process.env.APNS_TEAM_ID;
    const keyId = process.env.APNS_KEY_ID;
    const bundleId = process.env.APNS_BUNDLE_ID;
    const useSandbox = (process.env.APNS_USE_SANDBOX || "true") === "true";

    // Create JWT for APNs (valid <= 60 min)
    const jwtToken = jwt.sign(
      { iss: teamId, iat: Math.floor(Date.now() / 1000) },
      key,
      { algorithm: "ES256", header: { alg: "ES256", kid: keyId } }
    );

    const authority = useSandbox
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
    const client = connect(authority);

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "apns-topic": bundleId,
      "apns-push-type": "background", // silent push
      "apns-priority": "5", // low priority, background delivery
      authorization: `bearer ${jwtToken}`,
    };

    const req2 = client.request(headers);

    const payload = JSON.stringify({
      //aps: { "content-available": 1 },
      aps: {
  alert: { title: "Bird alert", body: "A new species was observed" },
  //badge: 5,
  sound: "default",
  "content-available": 1
},
//
      meta: { source: "vercel-cron", at: new Date().toISOString() },
    });

    let bodyResp = "";
    req2.setEncoding("utf8");
    req2.on("data", (chunk) => (bodyResp += chunk));

    const done = new Promise((resolve) => req2.on("end", resolve));
    req2.end(payload);
    await done;
    client.close();

    return res
      .status(200)
      .json({ ok: true, apnsResponse: bodyResp || "accepted" });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: e.message || "APNs send failed" });
  }
}