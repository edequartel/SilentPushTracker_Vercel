// /api/push_cron.ts (or .js)
import jwt from "jsonwebtoken";
import { connect, constants } from "http2";

export const config = { runtime: "nodejs18.x" }; // ensure Node, not Edge

export default async function handler(req, res) {
  // Health checks/monitors often use HEAD or OPTIONS → just say OK
  if (req.method === "HEAD" || req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Allow GET for external scheduler, POST for manual testing
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Use GET (cron) or POST" });
  }

  // For POST, allow overriding token via body; for GET, use env var
  const body = (req.method === "POST" && typeof req.body === "object") ? req.body :
               (req.method === "POST" && typeof req.body === "string" ? safeParse(req.body) : {});
  const token = body?.token || process.env.APNS_DEVICE_TOKEN;
  if (!token) return res.status(400).json({ error: "Missing device token (body.token or APNS_DEVICE_TOKEN)" });

  const keyRaw   = process.env.APNS_KEY || "";
  const teamId   = process.env.APNS_TEAM_ID || "";
  const keyId    = process.env.APNS_KEY_ID || "";
  const bundleId = process.env.APNS_BUNDLE_ID || "";
  const useSandbox = (process.env.APNS_USE_SANDBOX || "true") === "true";

  if (!keyRaw || !teamId || !keyId || !bundleId) {
    return res.status(500).json({ error: "Missing one or more APNs env vars" });
  }

  try {
    const key = keyRaw.replace(/\\n/g, "\n"); // handle pasted .p8
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
      "apns-push-type": "background", // silent push
      "apns-priority": "5",
      authorization: `bearer ${jwtToken}`,
    };

    const payload = JSON.stringify({
      aps: { "content-available": 1 },
      meta: { source: "vercel-cron", at: new Date().toISOString() },
    });

    const result = await new Promise((resolve) => {
      const req2 = client.request(headers);
      let bodyText = "";
      let status = 0;
      let apnsId: string | null = null;

      req2.setEncoding("utf8");
      req2.on("response", (h) => {
        status = Number(h[":status"] || 0);
        apnsId = (h["apns-id"] as string) || null;
      });
      req2.on("data", (chunk) => (bodyText += chunk));
      req2.on("end", () => resolve({ status, apnsId, bodyText }));

      // prevent hanging
      req2.setTimeout(15000, () => {
        try { req2.close(constants.NGHTTP2_CANCEL); } catch {}
      });

      req2.end(payload);
    });

    try { client.close(); } catch {}

    return res.status(200).json({ ok: true, result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "APNs send failed" });
  }
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}