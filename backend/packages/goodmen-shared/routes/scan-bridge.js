const requireFromRoot = require('../internal/require-from-root');
const express = requireFromRoot('express');
const crypto = require('crypto');
const multer = requireFromRoot('multer');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { decodeBarcodeFromBuffer } = require('../services/barcode-decode');

const scanUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

/**
 * @openapi
 * /api/scan-bridge/session:
 *   post:
 *     summary: Create scan bridge session
 *     tags:
 *       - ScanBridge
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Session created
 */
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

/**
 * @openapi
 * /api/scan-bridge/decode-image:
 *   post:
 *     summary: Decode barcode from photo
 *     description: Decodes a barcode from a camera photo (phone/tablet). No auth required — uses writeToken + sessionId for session validation. On success, pushes the decoded barcode to the bridge session via SSE.
 *     tags:
 *       - ScanBridge
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *               - writeToken
 *               - sessionId
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Barcode image file (max 10MB)
 *               writeToken:
 *                 type: string
 *                 description: Session write token
 *               sessionId:
 *                 type: string
 *                 description: Bridge session ID
 *     responses:
 *       201:
 *         description: Barcode decoded and pushed to session
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     barcode:
 *                       type: string
 *                 pushed:
 *                   type: boolean
 *       200:
 *         description: No barcode found in image
 *       400:
 *         description: No image uploaded
 *       403:
 *         description: Invalid write token
 *       404:
 *         description: Session not found or expired
 *       500:
 *         description: Failed to decode barcode
 */
router.post('/decode-image', scanUpload.single('image'), async (req, res) => {
  const writeToken = (req.body?.writeToken || req.query?.writeToken || '').toString();
  const sessionId = (req.body?.sessionId || req.query?.sessionId || req.body?.session || req.query?.session || '').toString();
  const session = getSessionForWrite(writeToken, sessionId || null);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found',
      hint: 'Session expired or invalid. Create a new phone bridge session from desktop and scan the new QR code.'
    });
  }
  if ((writeToken || '') !== session.writeToken) {
    return res.status(403).json({ success: false, error: 'Invalid write token' });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, error: 'No image uploaded; use field name "image".' });
  }

  try {
    const result = await decodeBarcodeFromBuffer(req.file.buffer);
    if (!result || !result.barcode) {
      return res.status(200).json({ success: true, data: { barcode: null }, pushed: false });
    }
    const payload = { barcode: result.barcode, timestamp: new Date().toISOString() };
    for (const client of session.clients) {
      try {
        client.write(`event: scan\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (_) {}
    }
    return res.status(201).json({ success: true, data: result, pushed: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to decode barcode from image.' });
  }
});

/**
 * @openapi
 * /api/scan-bridge/session/{id}/events:
 *   get:
 *     summary: Subscribe to scan session events (SSE)
 *     description: Opens a Server-Sent Events stream for the desktop to receive real-time barcode scan events from the mobile device. Requires readToken for authentication. Sends ping events every 20 seconds to keep the connection alive.
 *     tags:
 *       - ScanBridge
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bridge session ID
 *       - in: query
 *         name: readToken
 *         required: true
 *         schema:
 *           type: string
 *         description: Session read token
 *     responses:
 *       200:
 *         description: SSE stream opened (text/event-stream). Events — ready, scan, ping.
 *       403:
 *         description: Invalid read token
 *       404:
 *         description: Session not found or expired
 */
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

/**
 * @openapi
 * /api/scan-bridge/session/{id}/scan:
 *   post:
 *     summary: Push a barcode scan to session
 *     description: Pushes a scanned barcode value from the mobile device to the bridge session. All connected desktop SSE listeners receive the scan event in real time.
 *     tags:
 *       - ScanBridge
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bridge session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - barcode
 *               - writeToken
 *             properties:
 *               barcode:
 *                 type: string
 *                 description: Scanned barcode value
 *               writeToken:
 *                 type: string
 *                 description: Session write token
 *     responses:
 *       201:
 *         description: Barcode pushed to session
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     barcode:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Missing barcode
 *       403:
 *         description: Invalid write token
 *       404:
 *         description: Session not found or expired
 */
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

/**
 * @openapi
 * /api/scan-bridge/mobile:
 *   get:
 *     summary: Mobile scanner web page
 *     description: Serves the phone/tablet scanner HTML page with live camera barcode scanning (Quagga2), photo decode, VIN OCR (Tesseract.js), and manual barcode entry. Requires session ID and writeToken as query parameters.
 *     tags:
 *       - ScanBridge
 *     security: []
 *     parameters:
 *       - in: query
 *         name: session
 *         required: true
 *         schema:
 *           type: string
 *         description: Bridge session ID
 *       - in: query
 *         name: writeToken
 *         required: true
 *         schema:
 *           type: string
 *         description: Session write token
 *     responses:
 *       200:
 *         description: HTML page for mobile barcode scanning
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       400:
 *         description: Missing session or token
 */
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
  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
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
  <h3>Phone / Tablet Scanner</h3>
  <div class="row"><strong>Session</strong><div class="code">${sessionId}</div></div>

  <div class="row">
    <label><strong>Open camera &amp; scan barcode</strong></label>
    <p class="text-muted" style="font-size:14px; margin:4px 0;">Live scan: point your camera at a barcode; it will be sent to the desktop automatically.</p>
    <button id="startBtn" type="button">Open camera &amp; scan barcode</button>
    <div id="scanner"></div>
  </div>

  <div class="row">
    <label for="manualInput"><strong>Manual barcode</strong></label>
    <input id="manualInput" placeholder="e.g. TRK-001" autocomplete="off" />
    <button id="sendBtn" type="button">Send Barcode</button>
  </div>

  <div class="row">
    <label><strong>Take photo (inventory barcode)</strong></label>
    <p class="text-muted" style="font-size:14px; margin:4px 0;">Use camera to capture a barcode image; it will be decoded and sent to the desktop.</p>
    <input type="file" id="photoInput" accept="image/*" capture="environment" style="display:none" />
    <button id="photoBtn" type="button">Take photo / Choose image</button>
  </div>

  <div class="row">
    <label><strong>VIN OCR (camera)</strong></label>
    <button id="vinCamBtn" type="button">Start VIN OCR Camera</button>
    <video id="vinVideo" autoplay playsinline muted style="width:100%; max-width:360px; border-radius:6px; margin-top:8px; background:#000;"></video>
    <canvas id="vinCanvas" style="display:none;"></canvas>
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
      var photoBtn = document.getElementById('photoBtn');
      var photoInput = document.getElementById('photoInput');
      var vinCamBtn = document.getElementById('vinCamBtn');
      var vinVideo = document.getElementById('vinVideo');
      var vinCanvas = document.getElementById('vinCanvas');
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

      function vinChecksumValid(vin) {
        if (!vin || vin.length !== 17) return false;
        var map = {
          A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
          J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
          S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
        };
        var weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
        var sum = 0;
        for (var i = 0; i < 17; i++) {
          var ch = vin[i];
          var value = (ch >= '0' && ch <= '9') ? parseInt(ch, 10) : map[ch];
          if (value === undefined) return false;
          sum += value * weights[i];
        }
        var check = sum % 11;
        var expected = check === 10 ? 'X' : String(check);
        return vin[8] === expected;
      }

      function extractVin(text) {
        var upper = String(text || '').toUpperCase();
        var cleaned = upper
          .replace(/[^A-Z0-9]/g, '')
          .replace(/O/g, '0')
          .replace(/I/g, '1')
          .replace(/Q/g, '0');
        if (cleaned.length < 17) return '';
        var candidates = [];
        for (var i = 0; i <= cleaned.length - 17; i++) {
          var candidate = cleaned.slice(i, i + 17);
          if (/^[A-HJ-NPR-Z0-9]{17}$/.test(candidate)) {
            candidates.push(candidate);
          }
        }
        for (var c = 0; c < candidates.length; c++) {
          if (vinChecksumValid(candidates[c])) return candidates[c];
        }
        return candidates.length ? candidates[0] : '';
      }

      var vinStream = null;
      var vinTimer = null;
      var vinBusy = false;

      function startVinCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus('Camera not supported', 'err');
          return;
        }
        if (vinStream) return;
        setStatus('Starting VIN OCR camera...', 'ok');
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          .then(function (stream) {
            vinStream = stream;
            if (vinVideo) {
              vinVideo.srcObject = stream;
              vinVideo.play();
            }
            startVinOcrLoop();
            setStatus('VIN OCR camera started. Hold VIN steady.', 'ok');
            log('VIN OCR camera started');
          })
          .catch(function (e) {
            setStatus('Camera failed: ' + e.message, 'err');
          });
      }

      function stopVinCamera() {
        if (vinTimer) {
          clearInterval(vinTimer);
          vinTimer = null;
        }
        if (vinStream) {
          vinStream.getTracks().forEach(function (t) { t.stop(); });
          vinStream = null;
        }
        if (vinVideo) {
          vinVideo.srcObject = null;
        }
      }

      function startVinOcrLoop() {
        if (vinTimer) return;
        vinTimer = setInterval(function () {
          if (vinBusy || !vinVideo || !vinCanvas) return;
          var w = vinVideo.videoWidth || 0;
          var h = vinVideo.videoHeight || 0;
          if (!w || !h) return;
          vinCanvas.width = w;
          vinCanvas.height = h;
          var ctx = vinCanvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(vinVideo, 0, 0, w, h);
          vinBusy = true;
          Tesseract.recognize(vinCanvas, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789',
            tessedit_pageseg_mode: '7',
            preserve_interword_spaces: '1'
          })
            .then(function (result) {
              var text = (result && result.data && result.data.text) ? result.data.text : '';
              var vin = extractVin(text);
              if (vin) {
                manualInput.value = vin;
                postBarcode(vin);
                stopVinCamera();
              }
            })
            .catch(function () {})
            .finally(function () {
              vinBusy = false;
            });
        }, 2500);
      }

      startBtn.addEventListener('click', function (e) {
        e.preventDefault();
        startCamera();
      });

      sendBtn.addEventListener('click', function (e) {
        e.preventDefault();
        postBarcode(manualInput.value);
      });

      photoBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (photoInput) photoInput.click();
      });

      photoInput.addEventListener('change', function (e) {
        var file = e.target && e.target.files && e.target.files[0];
        if (!file) return;
        setStatus('Decoding photo...', 'ok');
        log('Uploading photo for decode');
        var fd = new FormData();
        fd.append('image', file);
        fd.append('writeToken', WRITE_TOKEN);
        fd.append('sessionId', SESSION_ID);
        fetch('/api/scan-bridge/decode-image', { method: 'POST', body: fd })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; }); })
          .then(function (result) {
            if (!result.ok) {
              var err = (result.body && result.body.error) ? result.body.error : ('HTTP ' + result.status);
              throw new Error(err);
            }
            var barcode = result.body && result.body.data && result.body.data.barcode;
            if (barcode) {
              setStatus('Decoded: ' + barcode + (result.body.pushed ? ' (sent to desktop)' : ''), 'ok');
              log('Decoded from photo: ' + barcode);
              if (!result.body.pushed) postBarcode(barcode);
            } else {
              setStatus('No barcode found in photo', 'err');
              log('No barcode found in photo');
            }
          })
          .catch(function (e) {
            setStatus('Photo decode failed: ' + e.message, 'err');
            log('Photo decode failed: ' + e.message);
          })
          .finally(function () {
            if (photoInput) photoInput.value = '';
          });
      });

      vinCamBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (vinStream) {
          stopVinCamera();
          setStatus('VIN OCR camera stopped', 'ok');
          return;
        }
        startVinCamera();
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
          stopVinCamera();
        } catch (_) {}
      });

      log('Ready');
      setStatus('Ready. Tap "Open camera & scan barcode" or enter a barcode below.', 'ok');
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

module.exports = router;
