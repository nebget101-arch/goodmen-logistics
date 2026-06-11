'use strict';

/**
 * FN-1222: Twilio Media Streams ASR client.
 *
 * Consumes the binary μ-law 8kHz audio stream sent by Twilio Media Streams
 * over a WebSocket and emits interim + final transcript events. The initial
 * implementation uses a simple pass-through buffer and logs audio metadata;
 * deep-gram/Whisper integration can replace processAudioChunk() in a follow-on.
 *
 * Protocol reference:
 *   https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */

const { EventEmitter } = require('node:events');

class AsrSession extends EventEmitter {
  constructor(callSid, { onTranscript } = {}) {
    super();
    this.callSid = callSid;
    this._buffer = [];
    this._streamSid = null;
    this._started = false;

    if (typeof onTranscript === 'function') {
      this.on('transcript', onTranscript);
    }
  }

  /** Handle a parsed Twilio Media Streams message */
  handleMessage(msg) {
    switch (msg.event) {
      case 'start':
        this._streamSid = msg.streamSid || (msg.start && msg.start.streamSid);
        this._started = true;
        this.emit('start', { callSid: this.callSid, streamSid: this._streamSid });
        break;

      case 'media':
        if (msg.media && msg.media.payload) {
          this._processChunk(msg.media.payload, msg.media.chunk);
        }
        break;

      case 'stop':
        this._flush();
        this.emit('stop', { callSid: this.callSid });
        break;

      default:
        break;
    }
  }

  _processChunk(base64Payload, chunkIndex) {
    const pcm = Buffer.from(base64Payload, 'base64');
    this._buffer.push(pcm);

    // Emit interim transcript every ~20 chunks (~2 s at 8kHz μ-law)
    if (this._buffer.length % 20 === 0) {
      this.emit('transcript', {
        callSid: this.callSid,
        type: 'interim',
        text: '',
        chunkIndex
      });
    }
  }

  _flush() {
    if (this._buffer.length > 0) {
      this.emit('transcript', {
        callSid: this.callSid,
        type: 'final',
        text: '',
        totalChunks: this._buffer.length
      });
      this._buffer = [];
    }
  }
}

function createAsrSession(callSid, opts) {
  return new AsrSession(callSid, opts);
}

module.exports = { createAsrSession, AsrSession };
