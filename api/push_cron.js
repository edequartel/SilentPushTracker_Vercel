// api/push_cron.js
import jwt from "jsonwebtoken";
import { connect } from "http2";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  // Allow HEAD (UptimeRobot), GET (cron), POST (manual test)
  if (!["GET", "POST", "HEAD"].includes(req.method)) {
    return res.status(405).json({ error: "Use GET/POST/HEAD" });
  }

  // Parse body (POST) and query (GET)
  let body = {};
  try {
    if (typeof req.body === "string") body = JSON.parse(req.body);
    else if (req.body) body = req.body;
  } catch {}

  const qsToken = req.query?.token; // allow ?token=...
  const token = body.token || qsToken || process.env.APNS_DEVICE_TOKEN;

  // If HEAD, just say “OK” quickly so UptimeRobot is happy
  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  if (!token) {
    // Still return 200 so UptimeRobot doesn’t keep retrying forever,
    // but report the issue in JSON.
    return res.status(200).json({ ok: false, reason: "Missing device token" });
  }

  // Prepare APNs JWT bits
  const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n");
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const useSandbox = (process.env.APNS_USE_SANDBOX || "true") === "true";

  if (!key || !teamId || !keyId || !bundleId) {
    return res.status(200).json({ ok: false, reason: "Missing APNs env vars" });
  }

  // Create JWT for APNs (valid <= 60 mins)
  const jwtToken = jwt.sign(
    { iss: teamId, iat: Math.floor(Date.now() / 1000) },
    key,
    { algorithm: "ES256", header: { alg: "ES256", kid: keyId } }
  );

  // Build APNs request
  const authority = useSandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const path = `/3/device/${token}`;

  const payload = {
    // Silent push
    "aps": { "content-available": 1 }
    // Add custom keys if your app expects them, e.g. "reason": "cron"
  };

  // Fire-and-respond-fast: don’t block UptimeRobot on APNs round-trip
  sendApns(jwtToken, authority, path, bundleId, payload)
    .then((status) => console.log("APNs sent:", status))
    .catch((e) => console.error("APNs error:", e?.message || e));

  // Immediate OK for the monitor
  return res.status(200).json({ ok: true, submitted: true });
}

function sendApns(jwtToken, authority, path, bundleId, payload) {
  return new Promise((resolve, reject) => {
    const client = connect(`https://${authority}`);

    client.on("error", reject);

    const headers = {
      ":method": "POST",
      ":path": path,
      "apns-topic": bundleId,
      authorization: `bearer ${jwtToken}`
    };

    const req = client.request(headers);
    req.setTimeout(8000); // be defensive

    req.on("response", (headers) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        client.close();
        resolve({ status: headers[":status"], body: data });
      });
    });

    req.on("error", (e) => {
      client.close();
      reject(e);
    });

    req.end(JSON.stringify(payload));
  });
}