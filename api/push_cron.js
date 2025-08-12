// api/push_cron.js
import jwt from "jsonwebtoken";
import { connect } from "http2";

// Ensure Node runtime (not Edge)
export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  // UptimeRobot often sends HEAD; respond OK without doing work
  if (req.method === "HEAD") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).end(); // no body for HEAD
  }

  // Allow GET for cron, POST for manual testing
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Use GET (cron) or POST" });
  }

  // Parse body safely
  let body = {};
  try {
    if (typeof req.body === "string") {
      body = JSON.parse(req.body);
    } else if (req.body && typeof req.body === "object") {
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

    if (!key || !teamId || !keyId || !bundleId) {
      return res.status(500).json({ error: "Missing APNs env variables" });
    }

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

    // Bubble up connection errors instead of crashing
    const clientError = new Promise((_, reject) =>
      client.on("error", (err) => reject(err))
    );

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "apns-topic": bundleId,
      "apns-push-type": "background", // silent push
      "apns-priority": "5", // background delivery
      authorization: `bearer ${jwtToken}`,
    };

    const req2 = client.request(headers);
    let timedOut = false;

    // Fail fast on slow networks so UptimeRobot doesn't mark it down
    req2.setTimeout(8000, () => {
      timedOut = true;
      try { req2.close(); } catch {}
    });

    const payload = JSON.stringify({
      aps: { "content-available": 1 },
      meta: { source: "vercel-cron", at: new Date().toISOString() },
    });

    let apnsBody = "";
    req2.setEncoding("utf8");
    req2.on("data", (chunk) => (apnsBody += chunk));

    const requestDone = new Promise((resolve, reject) => {
      req2.on("response", () => {});
      req2.on("end", resolve);
      req2.on("error", reject);
    });

    req2.end(payload);

    // Race request vs client error
    await Promise.race([requestDone, clientError]);

    client.close();

    if (timedOut) {
      return res.status(504).json({ error: "APNs request timed out" });
    }

    return res.status(200).json({ ok: true, apnsResponse: apnsBody || "accepted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "APNs send failed" });
  }
}