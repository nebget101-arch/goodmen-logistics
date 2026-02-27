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
  
  <div style="margin-top: 20px; padding: 12px; background: #f0f0f0; border-radius: 4px; border: 1px solid #999; font-size: 12px; font-family: monospace; max-height: 200px; overflow-y: auto;">
    <strong>Debug Log:</strong>
    <div id="debug-log" style="margin-top: 8px; line-height: 1.4; color: #333;"></div>
  </div>

<script>
const sessionId = ${JSON.stringify(sessionId)};
const writeToken = ${JSON.stringify(writeToken)};
let detector = null;
let stream = null;
let timer = null;
let logLines = [];

// Don't try to log until DOM is ready
function addLog(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const line = timestamp + ' [' + type.toUpperCase() + '] ' + msg;
  logLines.push(line);
  
  // Keep only last 50 lines
  if (logLines.length > 50) {
    logLines.shift();
  }
  
  // Find the debug log element - it might not exist yet
  const debugLog = document.getElementById('debug-log');
  if (debugLog) {
    debugLog.textContent = logLines.join('\n');
    // Auto-scroll to bottom
    try {
      debugLog.parentElement.scrollTop = debugLog.parentElement.scrollHeight;
    } catch (_) {}
  }
  
  console.log('[' + type + ']', msg);
}

function setStatus(msg, cls) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = cls || '';
    statusEl.textContent = msg;
  }
  addLog(msg, cls || 'status');
}

async function postBarcode(barcode) {
  addLog('📤 Sending barcode: ' + barcode, 'info');
  try {
    const url = '/api/scan-bridge/session/' + encodeURIComponent(sessionId) + '/scan';
    const payload = { writeToken, barcode };
    
    addLog('POST to: ' + url, 'debug');
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    addLog('Response status: ' + res.status, 'debug');
    const data = await res.json().catch(err => {
      addLog('JSON parse error: ' + err.message, 'error');
      return {};
    });
    
    if (!res.ok) {
      const errMsg = data.error || 'Failed to send barcode (status ' + res.status + ')';
      throw new Error(errMsg);
    }
    setStatus('✅ Barcode sent successfully: ' + barcode, 'ok');
    return true;
  } catch (e) {
    const errMsg = e.message || String(e);
    addLog('Send error: ' + errMsg, 'error');
    setStatus('❌ Error: ' + errMsg, 'err');
    throw e;
  }
}

async function startScan() {
  try {
    addLog('📷 Start camera button pressed', 'info');
    setStatus('Requesting camera access...', 'ok');
    
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' } 
    });
    addLog('✅ Camera stream obtained', 'success');
    
    const videoEl = document.getElementById('video');
    if (!videoEl) {
      throw new Error('Video element not found');
    }
    videoEl.srcObject = stream;
    
    let hasDetector = false;
    if ('BarcodeDetector' in window) {
      try {
        const supportedFormats = await BarcodeDetector.getSupportedFormats();
        addLog('BarcodeDetector supported formats: ' + supportedFormats.join(', '), 'debug');
        hasDetector = supportedFormats && supportedFormats.length > 0;
        
        if (hasDetector) {
          detector = new BarcodeDetector({ formats: supportedFormats });
          timer = setInterval(async () => {
            try {
              const barcodes = await detector.detect(videoEl);
              if (barcodes && barcodes.length > 0) {
                const raw = (barcodes[0].rawValue || '').trim();
                if (raw) {
                  addLog('🔍 Barcode auto-detected: ' + raw, 'success');
                  await postBarcode(raw);
                }
              }
            } catch (err) {
              addLog('Detection error: ' + err.message, 'debug');
            }
          }, 700);
          setStatus('✓ Camera active (auto-detect enabled)', 'ok');
        }
      } catch (e) {
        addLog('BarcodeDetector not available: ' + e.message, 'debug');
      }
    } else {
      addLog('⚠️ BarcodeDetector API not supported on this device', 'info');
    }
    
    if (!hasDetector) {
      setStatus('📷 Camera ready. Type barcode below.', 'ok');
      addLog('Use manual input to send barcodes', 'info');
    }
  } catch (e) {
    const errMsg = e.message || String(e);
    addLog('Camera error: ' + errMsg, 'error');
    setStatus('Camera error: ' + errMsg, 'err');
  }
}

function setupButtons() {
  addLog('Setting up button listeners...', 'info');
  
  const sendBtn = document.getElementById('sendManual');
  const startBtn = document.getElementById('start');
  const manualInput = document.getElementById('manual');
  const debugLog = document.getElementById('debug-log');
  
  addLog('Elements found - send: ' + !!sendBtn + ', start: ' + !!startBtn + ', input: ' + !!manualInput + ', debug: ' + !!debugLog, 'debug');
  
  if (sendBtn) {
    sendBtn.addEventListener('click', function(e) {
      addLog('🖱️ Send button clicked', 'info');
      e.preventDefault();
      e.stopPropagation();
      
      const v = manualInput.value.trim();
      addLog('Input value: "' + v + '"', 'debug');
      
      if (!v) {
        setStatus('Please enter a barcode', 'err');
        addLog('Input was empty', 'warn');
        return;
      }
      
      postBarcode(v).then(() => {
        manualInput.value = '';
        manualInput.focus();
      }).catch(err => {
        addLog('Send error: ' + (err.message || String(err)), 'error');
      });
    });
    addLog('✅ Send button listener attached', 'success');
  } else {
    addLog('❌ Send button NOT FOUND', 'error');
  }
  
  if (manualInput) {
    manualInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        addLog('⌨️ Enter key pressed in input', 'info');
        e.preventDefault();
        const sendBtn = document.getElementById('sendManual');
        if (sendBtn) sendBtn.click();
      }
    });
    addLog('✅ Input listener attached', 'success');
  } else {
    addLog('❌ Input NOT FOUND', 'error');
  }
  
  if (startBtn) {
    startBtn.addEventListener('click', function(e) {
      addLog('🖱️ Start camera button clicked', 'info');
      e.preventDefault();
      e.stopPropagation();
      startScan();
    });
    addLog('✅ Start button listener attached', 'success');
  } else {
    addLog('❌ Start button NOT FOUND', 'error');
  }
  
  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer);
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
  
  addLog('✅ All listeners setup complete. Ready!', 'success');
  setStatus('Ready! Type a barcode or tap camera.', 'ok');
}

// Wait for DOM to be fully ready before setting up
function initializeWhenReady() {
  // Give the DOM a moment to fully render
  setTimeout(() => {
    try {
      addLog('Script initialized!', 'success');
      setupButtons();
    } catch (err) {
      console.error('Initialization error:', err);
      alert('Error: ' + err.message);
    }
  }, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeWhenReady);
} else {
  initializeWhenReady();
}
</script>
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

module.exports = router;
