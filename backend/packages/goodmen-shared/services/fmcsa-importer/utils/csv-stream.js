'use strict';

const { Transform } = require('node:stream');

const QUOTE = 0x22; // "
const CR = 0x0d;
const LF = 0x0a;

/**
 * RFC-4180-ish streaming CSV row parser.
 *
 * Returns a Transform stream that consumes raw bytes (Buffers) and emits
 * one parsed row per push as an object keyed on header names. The first
 * non-empty record is treated as the header.
 *
 * Field parsing handles:
 *   - Quoted fields with embedded commas, CR/LF, and escaped quotes ("")
 *   - Mixed line endings (LF or CRLF)
 *   - Configurable delimiter (comma by default, pipe for some FMCSA dumps)
 *
 * Memory profile: O(longest_row), not O(file). The internal buffer is
 * reset every time a row is emitted, so a 2 GB file flows through in
 * a flat memory footprint (verified on the local fixture multiplied
 * 100k× for FN-1420 acceptance criterion).
 */
function createCsvStream({ delimiter = ',', skipEmptyLines = true } = {}) {
  const delimByte = delimiter.charCodeAt(0);
  let header = null;

  // Per-record state
  let fields = [];
  let field = [];
  let inQuotes = false;
  let prevByte = -1; // for CRLF handling

  // Lifted into closure so flush() can emit a trailing record
  function pushField() {
    fields.push(Buffer.from(field).toString('utf8'));
    field = [];
  }

  function emitRow(stream) {
    pushField();

    if (skipEmptyLines && fields.length === 1 && fields[0].length === 0) {
      fields = [];
      return;
    }

    if (header === null) {
      header = fields.map((h) => h.trim());
      fields = [];
      return;
    }

    const row = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = i < fields.length ? fields[i] : '';
    }
    stream.push(row);
    fields = [];
  }

  return new Transform({
    readableObjectMode: true,
    writableObjectMode: false,
    transform(chunk, _enc, cb) {
      try {
        for (let i = 0; i < chunk.length; i++) {
          const b = chunk[i];

          if (inQuotes) {
            if (b === QUOTE) {
              if (i + 1 < chunk.length && chunk[i + 1] === QUOTE) {
                // escaped quote
                field.push(QUOTE);
                i++;
              } else {
                inQuotes = false;
              }
            } else {
              field.push(b);
            }
            prevByte = b;
            continue;
          }

          if (b === QUOTE) {
            inQuotes = true;
          } else if (b === delimByte) {
            pushField();
          } else if (b === LF) {
            // CR already triggered the row emit; swallow the trailing LF.
            if (prevByte !== CR) emitRow(this);
          } else if (b === CR) {
            emitRow(this);
          } else {
            field.push(b);
          }
          prevByte = b;
        }
        cb();
      } catch (err) {
        cb(err);
      }
    },
    flush(cb) {
      // Emit any trailing field/row that wasn't terminated by a newline
      if (field.length > 0 || fields.length > 0) {
        emitRow(this);
      }
      cb();
    },
  });
}

module.exports = { createCsvStream };
