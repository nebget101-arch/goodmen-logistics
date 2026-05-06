'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { Readable } = require('node:stream');

const { createCsvStream } = require('../utils/csv-stream');

function asStream(text) {
  return Readable.from(Buffer.from(text, 'utf8'));
}

async function collect(stream) {
  const out = [];
  for await (const row of stream) out.push(row);
  return out;
}

describe('csv-stream', () => {
  it('parses a simple header + rows', async () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.deepEqual(rows, [
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('handles CRLF line endings interchangeably with LF', async () => {
    const csv = 'a,b\r\n1,2\r\n3,4\n5,6\r\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.deepEqual(rows, [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
      { a: '5', b: '6' },
    ]);
  });

  it('preserves embedded commas inside quoted fields', async () => {
    const csv = 'name,addr\n"ACME","100 MAIN ST, SUITE A"\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.equal(rows[0].name, 'ACME');
    assert.equal(rows[0].addr, '100 MAIN ST, SUITE A');
  });

  it('decodes escaped double-quotes inside quoted fields', async () => {
    const csv = 'note\n"she said ""hello"""\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.equal(rows[0].note, 'she said "hello"');
  });

  it('preserves embedded newlines inside quoted fields', async () => {
    const csv = 'note,kind\n"line1\nline2",x\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.deepEqual(rows, [{ note: 'line1\nline2', kind: 'x' }]);
  });

  it('skips empty lines by default', async () => {
    const csv = 'a,b\n1,2\n\n3,4\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.equal(rows.length, 2);
  });

  it('emits a final row that lacks a trailing newline', async () => {
    const csv = 'a,b\n1,2'; // no trailing \n
    const rows = await collect(asStream(csv).pipe(createCsvStream()));
    assert.deepEqual(rows, [{ a: '1', b: '2' }]);
  });

  it('survives a chunk boundary in the middle of a quoted field', async () => {
    // Manually feed bytes in two pieces to force a mid-quote boundary.
    const stream = createCsvStream();
    const collected = collect(stream);
    stream.write(Buffer.from('a,b\n"hello, ', 'utf8'));
    stream.write(Buffer.from('world",2\n', 'utf8'));
    stream.end();
    const rows = await collected;
    assert.deepEqual(rows, [{ a: 'hello, world', b: '2' }]);
  });

  it('handles configurable delimiter (pipe)', async () => {
    const csv = 'a|b|c\n1|2|3\n';
    const rows = await collect(asStream(csv).pipe(createCsvStream({ delimiter: '|' })));
    assert.deepEqual(rows[0], { a: '1', b: '2', c: '3' });
  });

  it('streams 50k rows in flat memory (smoke for AC: 2M+ row file without OOM)', async () => {
    // Build a synthetic CSV in pieces; the parser should not retain rows past emit.
    const stream = createCsvStream();
    let count = 0;
    let lastRow = null;

    const reader = (async () => {
      for await (const row of stream) {
        count++;
        lastRow = row;
      }
    })();

    stream.write('id,name,note\n');
    for (let i = 0; i < 50_000; i++) {
      stream.write(`${i},name-${i},"value, with, commas"\n`);
    }
    stream.end();
    await reader;

    assert.equal(count, 50_000);
    assert.equal(lastRow.id, '49999');
    assert.equal(lastRow.note, 'value, with, commas');
  });
});
