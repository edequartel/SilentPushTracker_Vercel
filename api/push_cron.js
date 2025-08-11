// /api/push.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { connect } from "http2";

export const config = { api: { bodyParser: true } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Accept either:
    // - POST { token } for manual testing
    // - GET ?token=... for ad-hoc
    // - fallback to env for cron
    const tokenFromBody = (req.method === "POST" && (req.body?.token as string)) || "";
    const tokenFromQuery = (req.method === "GET" && (req.query?.token as string)) || "";
    const token = tokenFromBody || tokenFromQuery || process.env.APNS_DEVICE_TOKEN || "";

    if (!token) return res.status(400).json({ error: "Missing device token (body.token, query.token, or APNS_DEVICE_TOKEN)" });

    const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n");
    const teamId = process.env.APNS_TEAM_ID || "";
    const keyId = process.env.APNS_KEY_ID || "";
    const bundleId = process.env.APNS_BUNDLE_ID || "";
    const useSandbox = (process.env.APNS_USE_SANDBOX || "true") === "true";

    if (!key || !teamId || !keyId || !bundleId) {
      return res.status(500).json({ error: "Missing APNs env vars (APNS_KEY, APNS_TEAM_ID, APNS_KEY_ID, APNS_BUNDLE_ID)" });
    }

    // JWT for APNs (valid <= 60 min)
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
      "apns-push-type": "background", // silent/background
      "apns-priority": "5",           // background delivery
      "authorization": `bearer ${jwtToken}`
    };

    const req2 = client.request(headers);

    const payload = JSON.stringify({
      aps: { "content-available": 1 }, // silent; no alert
      meta: { source: "vercel", at: new Date().toISOString() }
    });

    let body = "";
    req2.setEncoding("utf8");
    req2.on("data", (chunk) => (body += chunk));

    const done = new Promise<void>((resolve) => req2.on("end", () => resolve()));
    req2.end(payload);
    await done;
    client.close();

    return res.status(200).json({ ok: true, apnsResponse: body || "accepted" });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "APNs send failed" });
  }
}