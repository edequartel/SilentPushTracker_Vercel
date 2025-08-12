// Sends an APNs *silent* push to a single device token.
// POST JSON: { "token": "<apns-device-token>" }

import jwt from "jsonwebtoken";
import { connect } from "http2";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing 'token' in JSON body" });

  try {
    const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n"); // handle pasted .p8
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

    const authority = useSandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    const client = connect(authority);

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "apns-topic": bundleId,            // your app bundle id
      "apns-push-type": "alert",    // silent/background
      "apns-priority": "10",              // low priority, background delivery
      "authorization": `bearer ${jwtToken}`
    };

    const req2 = client.request(headers);

    // Silent payload → your iOS already increments on receipt; no UI alert
    //const payload = JSON.stringify({
      //aps: { "content-available": 1, "badge": 7136},
      //meta: { source: "vercel", at: new Date().toISOString() }
    //});

aps: {
  alert: { title: "Bird alert", body: "A new species was observed" },
  badge: 5,
  sound: "default",
  "content-available": 1
}

//
    let body = "";
    req2.setEncoding("utf8");
    req2.on("data", chunk => (body += chunk));

    const done = new Promise((resolve) => req2.on("end", resolve));
    req2.end(payload);
    await done;
    client.close();

    return res.status(200).json({ ok: true, apnsResponse: body || "accepted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "APNs send failed" });
  }
}