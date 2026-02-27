const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');

const SESSION_TTL_MS = 1000 * 60 * 30;
const sessions = new Map();

function randToken() {
  return crypto.randomBytes(16).toString('hex');
}

function now() {
  return Date.now();
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (now() - session.createdAt > SESSION_TTL_MS) {
    try {
      for (const client of session.clients) {
        client.end();
      }
    } catch (_) {}
    sessions.delete(id);
    return null;
  }
  return session;
}

setInterval(() => {
  for (const [id, session] of sessions.entries()) {
    if (now() - session.createdAt > SESSION_TTL_MS) {
      try {
        for (const client of session.clients) {
          client.end();
        }
      } catch (_) {}
      sessions.delete(id);
    }
  }
}, 60_000).unref();

router.post('/session', authMiddleware, (req, res) => {
  const id = crypto.randomUUID();
  const writeToken = randToken();
  const readToken = randToken();

  const session = {
    id,
    writeToken,
    readToken,
    createdAt: now(),
    clients: new Set()
  };

  sessions.set(id, session);

  const origin = `${req.protocol}://${req.get('host')}`;
  const mobileUrl = `${origin}/api/scan-bridge/mobile?session=${encodeURIComponent(id)}&writeToken=${encodeURIComponent(writeToken)}`;

  res.status(201).json({
    success: true,
    data: {
      sessionId: id,
      writeToken,
      readToken,
      mobileUrl,
      expiresInSeconds: Math.floor(SESSION_TTL_MS / 1000)
    }
  });
});

router.get('/session/:id/events', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if ((req.query.readToken || '') !== session.readToken) {
    return res.status(403).json({ error: 'Invalid read token' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  session.clients.add(res);

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ t: now() })}\n\n`);
  }, 20_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    session.clients.delete(res);
  });
});

router.post('/session/:id/scan', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const writeToken = req.body?.writeToken || req.query.writeToken;
  if ((writeToken || '') !== session.writeToken) {
    return res.status(403).json({ error: 'Invalid write token' });
  }

  const barcode = (req.body?.barcode || '').toString().trim();
  if (!barcode) {
    return res.status(400).json({ error: 'barcode is required' });
  }

  const payload = {
    barcode,
    timestamp: new Date().toISOString()
  };

  for (const client of session.clients) {
    client.write(`event: scan\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  return res.status(201).json({ success: true, data: payload });
});

router.get('/mobile', (req, res) => {
  const sessionId = (req.query.session || '').toString();
  const writeToken = (req.query.writeToken || '').toString();

  if (!sessionId || !writeToken) {
    return res.status(400).send('Missing session or token');
  }

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Scan Bridge</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
      padding: 16px; 
      max-width: 100%;
      background: #f5f5f5;
    }
    h3 { margin: 0 0 16px 0; color: #333; }
    .code-display { 
      background: #f0f0f0; 
      padding: 8px 12px; 
      font-family: monospace; 
      font-size: 12px; 
      border-radius: 4px; 
      word-break: break-all;
    }
    input, button { 
      font-size: 16px; 
      padding: 12px; 
      width: 100%; 
      box-sizing: border-box;
      margin-top: 8px; 
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    button {
      background: #0066cc;
      color: white;
      border: none;
      font-weight: 600;
      cursor: pointer;
    }
    button:active { background: #0052a3; }
    video { 
      width: 100%; 
      max-height: 60vh; 
      background: #000; 
      margin-top: 10px;
      border-radius: 4px;
      display: block;
    }
    .ok { color: #0a7d2b; margin-top: 8px; font-weight: 500; }
    .err { color: #b42318; margin-top: 8px; font-weight: 500; }
    .row { margin-bottom: 12px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 14px; }
  </style>
</head>
<body>
  <h3>📱 Phone Scanner Bridge</h3>
  
  <div class="row">
    <strong>Session:</strong><br />
    <div class="code-display">${sessionId}</div>
  </div>

  <button id="start">📷 Start Camera (optional)</button>
  
  <video id="video" playsinline autoplay muted></video>

  <div class="row">
    <label><strong>📝 Enter Barcode Number</strong></label>
    <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Type the numbers shown under the barcode (e.g., for SKU: TRK-001, use that as your barcode)</p>
    <input id="manual" placeholder="e.g., TRK-001" autocomplete="off" />
    <button id="sendManual">✓ Send Barcode</button>
  </div>

  <div id="status"></div>

<script>
const sessionId = ${JSON.stringify(sessionId)};
const writeToken = ${JSON.stringify(writeToken)};
const statusEl = document.getElementById('status');
const videoEl = document.getElementById('video');
let detector = null;
let stream = null;
let timer = null;

function setStatus(msg, cls) {
  statusEl.className = cls || '';
  statusEl.textContent = msg;
}

async function postBarcode(barcode) {
  const res = await fetch('/api/scan-bridge/session/' + encodeURIComponent(sessionId) + '/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writeToken, barcode })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to send barcode');
  setStatus('Sent: ' + barcode, 'ok');
}

document.getElementById('sendManual').addEventListener('click', async () => {
  try {
    const v = document.getElementById('manual').value.trim();
    if (!v) return;
    await postBarcode(v);
    document.getElementById('manual').value = '';
    document.getElementById('manual').focus();
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  }
});

document.getElementById('manual').addEventListener('keyup', async (e) => {
  if (e.key === 'Enter') document.getElementById('sendManual').click();
});

async function startScan() {
  try {
    // Always request camera access first
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment', focusMode: 'continuous' } 
    });
    videoEl.srcObject = stream;
    
    let hasDetector = false;
    let supportedFormats = [];

    // If BarcodeDetector is available, try to use it
    if ('BarcodeDetector' in window) {
      try {
        // Check which formats are actually supported on this device
        supportedFormats = await BarcodeDetector.getSupportedFormats();
        hasDetector = supportedFormats && supportedFormats.length > 0;
      } catch (e) {
        hasDetector = false;
      }
      
      if (hasDetector) {
        detector = new BarcodeDetector({ formats: supportedFormats });
        timer = setInterval(async () => {
          try {
            const barcodes = await detector.detect(videoEl);
            if (barcodes && barcodes.length > 0) {
              const raw = (barcodes[0].rawValue || '').trim();
              if (!raw) return;
              await postBarcode(raw);
            }
          } catch (_) {}
        }, 700);
        setStatus('✓ Camera scanning active (auto-detect). Formats: ' + supportedFormats.join(', '), 'ok');
      }
    }
    
    if (!hasDetector) {
      // Fallback: camera open, manual input primary
      setStatus('📷 Camera ready. Type barcode number below or try manual input (iOS doesn\'t support auto-detect)', 'ok');
      // Auto-focus the manual input field on iOS
      setTimeout(() => document.getElementById('manual').focus(), 500);
    }
  } catch (e) {
    throw new Error('Camera access denied or unavailable: ' + (e.message || String(e)));
  }
}

document.getElementById('start').addEventListener('click', async () => {
  try {
    await startScan();
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  }
});

window.addEventListener('beforeunload', () => {
  if (timer) clearInterval(timer);
  if (stream) stream.getTracks().forEach(t => t.stop());
});
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

module.exports = router;
