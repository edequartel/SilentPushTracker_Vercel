// api/push.ts
import jwt from "jsonwebtoken";
import { connect } from "http2";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Use GET (cron) or POST" });
  }

  // Prefer body token (manual test), else env token (cron)
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const token = body.token || process.env.APNS_DEVICE_TOKEN;
  if (!token) return res.status(400).json({ error: "Missing device token (body.token or APNS_DEVICE_TOKEN)" });

  try {
    const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n");
    const teamId = process.env.APNS_TEAM_ID!;
    const keyId = process.env.APNS_KEY_ID!;
    const bundleId = process.env.APNS_BUNDLE_ID!;
    const useSandbox = (process.env.APNS_USE_SANDBOX || "true") === "true";

    // Create JWT (APNs allows up to 60 minutes)
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
      "apns-topic": bundleId,
      "apns-push-type": "background",
      "apns-priority": "5",
      "authorization": `bearer ${jwtToken}`
    };

    const req2 = client.request(headers);

    const payload = JSON.stringify({
      aps: { "content-available": 1 },
      meta: { source: "vercel", at: new Date().toISOString() }
    });

    let bodyResp = "";
    req2.setEncoding("utf8");
    req2.on("data", (chunk) => (bodyResp += chunk));

    const done = new Promise((resolve) => req2.on("end", resolve));
    req2.end(payload);
    await done;
    client.close();

    // Do not echo the token back
    return res.status(200).json({ ok: true, apnsResponse: bodyResp || "accepted" });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message || "APNs send failed" });
  }
}