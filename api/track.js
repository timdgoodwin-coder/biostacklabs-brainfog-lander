// api/track.js — Meta Conversions API (CAPI) bridge.
//
// Vercel serverless function. No package.json / dependencies: uses the global
// fetch available on Vercel's Node 18+ runtime. The browser posts each event
// here with the same event_id it also sent via the Meta Pixel, so Meta dedupes
// the server-side (CAPI) hit against the browser (Pixel) hit.
//
// Env vars (set on Vercel):
//   FB_PIXEL_ID          (required) Meta Pixel / dataset ID
//   FB_ACCESS_TOKEN      (required) Conversions API access token
//   FB_API_VERSION       (optional) Graph API version, default v21.0
//   FB_TEST_EVENT_CODE   (optional) forwards events to Test Events in Events Manager

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const PIXEL_ID = process.env.FB_PIXEL_ID;
  const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
  const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
  const TEST_EVENT_CODE = process.env.FB_TEST_EVENT_CODE;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return res
      .status(500)
      .json({ error: 'Server not configured: missing FB_PIXEL_ID or FB_ACCESS_TOKEN' });
  }

  // Body may arrive already parsed (Vercel) or as a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const { event_id, event_name, event_source_url, custom_data, fbp, fbc } = body;

  const xff = req.headers['x-forwarded-for'] || '';
  const clientIp =
    xff.split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  const userAgent = req.headers['user-agent'] || '';

  const user_data = {
    client_ip_address: clientIp,
    client_user_agent: userAgent,
  };
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

  const payload = {
    data: [
      {
        event_name: event_name || 'PageView',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: event_source_url,
        event_id: event_id,
        user_data: user_data,
        custom_data: custom_data || {},
      },
    ],
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  const url =
    'https://graph.facebook.com/' +
    API_VERSION +
    '/' +
    PIXEL_ID +
    '/events?access_token=' +
    encodeURIComponent(ACCESS_TOKEN);

  try {
    const fbRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await fbRes.json();
    return res.status(fbRes.status).json(json);
  } catch (err) {
    return res.status(502).json({ error: 'CAPI request failed', detail: String(err) });
  }
};
