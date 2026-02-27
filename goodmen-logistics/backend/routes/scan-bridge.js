const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');

const SESSION_TTL_MS = 1000 * 60 * 30;
const sessions = new Map();
const sessionIdByWriteToken = new Map();

function randToken() {
  return crypto.randomBytes(16).toString('hex');
}

function now() {
  return Date.now();
}

function closeSession(id, session) {
  try {
    for (const client of session.clients) {
      client.end();
    }
  } catch (_) {}
  sessions.delete(id);
  if (session?.writeToken) {
    sessionIdByWriteToken.delete(session.writeToken);
  }
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (now() - (session.lastSeenAt || session.createdAt) > SESSION_TTL_MS) {
    closeSession(id, session);
    return null;
  }
  session.lastSeenAt = now();
  return session;
}

function getSessionForWrite(writeToken, idHint) {
  if (idHint) {
    const byId = getSession(idHint);
    if (byId) return byId;
  }

  const sid = sessionIdByWriteToken.get(writeToken || '');
  if (!sid) return null;
  return getSession(sid);
}

setInterval(() => {
  for (const [id, session] of sessions.entries()) {
    if (now() - (session.lastSeenAt || session.createdAt) > SESSION_TTL_MS) {
      closeSession(id, session);
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
    lastSeenAt: now(),
    clients: new Set()
  };

  sessions.set(id, session);
  sessionIdByWriteToken.set(writeToken, id);

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
  const writeToken = req.body?.writeToken || req.query.writeToken;
  const session = getSessionForWrite(writeToken, req.params.id);
  if (!session) {
    return res.status(404).json({
      error: 'Session not found',
      hint: 'Session expired or invalid. Create a new phone bridge session from desktop and scan the new QR code.'
    });
  }

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
  <title>Phone Scanner Bridge</title>
  <script src="https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.8.4/dist/quagga.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; background: #f5f5f5; }
    .row { margin-bottom: 12px; }
    .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:#ececec; padding:8px; border-radius:4px; }
    #scanner { width:100%; min-height:260px; background:#000; border-radius:6px; overflow:hidden; }
    input, button { width:100%; padding:12px; margin-top:8px; font-size:16px; box-sizing:border-box; }
    button { border:0; border-radius:6px; background:#1565c0; color:#fff; font-weight:600; }
    #status.ok { color:#0a7d2b; }
    #status.err { color:#b42318; }
    #log { margin-top:10px; padding:8px; background:#efefef; border:1px solid #ccc; min-height:70px; max-height:180px; overflow:auto; font:12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <h3>Phone Scanner Bridge</h3>
  <div class="row"><strong>Session</strong><div class="code">${sessionId}</div></div>

  <button id="startBtn" type="button">Start Camera</button>
  <div id="scanner"></div>

  <div class="row">
    <label for="manualInput"><strong>Manual barcode</strong></label>
    <input id="manualInput" placeholder="e.g. TRK-001" autocomplete="off" />
    <button id="sendBtn" type="button">Send Barcode</button>
  </div>

  <div id="status"></div>
  <div id="log"></div>

  <script>
    (function () {
      var SESSION_ID = ${JSON.stringify(sessionId)};
      var WRITE_TOKEN = ${JSON.stringify(writeToken)};
      var quaggaRunning = false;
      var onDetectedHandler = null;

      var startBtn = document.getElementById('startBtn');
      var sendBtn = document.getElementById('sendBtn');
      var manualInput = document.getElementById('manualInput');
      var statusEl = document.getElementById('status');
      var logEl = document.getElementById('log');

      function log(msg) {
        if (!logEl) return;
        var row = document.createElement('div');
        row.textContent = new Date().toLocaleTimeString() + ' ' + msg;
        logEl.appendChild(row);
        logEl.scrollTop = logEl.scrollHeight;
      }

      function setStatus(msg, cls) {
        if (!statusEl) return;
        statusEl.className = cls || '';
        statusEl.textContent = msg;
      }

      function postBarcode(barcode) {
        var value = (barcode || '').trim();
        if (!value) {
          setStatus('Barcode is empty', 'err');
          return;
        }

        log('Sending: ' + value);
        fetch('/api/scan-bridge/session/' + encodeURIComponent(SESSION_ID) + '/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writeToken: WRITE_TOKEN, barcode: value })
        })
          .then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
          })
          .then(function (result) {
            if (!result.ok) {
              var err = (result.body && result.body.error) ? result.body.error : ('HTTP ' + result.status);
              throw new Error(err);
            }
            setStatus('Sent: ' + value, 'ok');
            log('Sent OK');
            manualInput.value = '';
          })
          .catch(function (e) {
            setStatus('Send failed: ' + e.message, 'err');
            log('Send failed: ' + e.message);
          });
      }

      function startCamera() {
        if (typeof Quagga === 'undefined') {
          setStatus('Scanner library not loaded; use manual input.', 'err');
          log('Quagga not loaded');
          return;
        }

        if (quaggaRunning) {
          setStatus('Camera already running', 'ok');
          return;
        }

        setStatus('Starting camera...', 'ok');
        log('Initializing camera');

        Quagga.init({
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: document.getElementById('scanner'),
            constraints: { facingMode: 'environment' }
          },
          decoder: {
            readers: ['code_128_reader', 'ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader', 'code_39_reader']
          },
          locate: true
        }, function (err) {
          if (err) {
            setStatus('Camera failed: ' + err.message, 'err');
            log('Camera failed: ' + err.message);
            return;
          }

          onDetectedHandler = function (result) {
            var code = result && result.codeResult && result.codeResult.code ? result.codeResult.code.trim() : '';
            if (!code) return;
            log('Detected: ' + code);
            postBarcode(code);
          };

          Quagga.onDetected(onDetectedHandler);
          Quagga.start();
          quaggaRunning = true;
          setStatus('Camera started. Point at barcode.', 'ok');
          log('Camera started');
        });
      }

      startBtn.addEventListener('click', function (e) {
        e.preventDefault();
        startCamera();
      });

      sendBtn.addEventListener('click', function (e) {
        e.preventDefault();
        postBarcode(manualInput.value);
      });

      manualInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          postBarcode(manualInput.value);
        }
      });

      window.addEventListener('beforeunload', function () {
        try {
          if (quaggaRunning) {
            if (onDetectedHandler) Quagga.offDetected(onDetectedHandler);
            Quagga.stop();
          }
        } catch (_) {}
      });

      log('Ready');
      setStatus('Ready. Tap Start Camera or use manual input.', 'ok');
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

module.exports = router;
