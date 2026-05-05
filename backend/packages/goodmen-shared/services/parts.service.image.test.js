'use strict';

/**
 * FN-1098: Tests for the image_r2_key → parts.image_url patch helper.
 *
 * Pure unit tests — no DB. We require the service module but only exercise
 * `resolveImageR2Patch`, which has no DB or external dependencies.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { resolveImageR2Patch } = require('./parts.service');

describe('resolveImageR2Patch (FN-1098)', () => {
  it('maps image_r2_key to image_url', () => {
    const patch = resolveImageR2Patch({ image_r2_key: 'parts/photos/abc123.jpg' });
    assert.deepEqual(patch, { image_url: 'parts/photos/abc123.jpg' });
  });

  it('clears image_url when image_r2_key is null', () => {
    const patch = resolveImageR2Patch({ image_r2_key: null });
    assert.deepEqual(patch, { image_url: null });
  });

  it('clears image_url when image_r2_key is empty string', () => {
    const patch = resolveImageR2Patch({ image_r2_key: '' });
    assert.deepEqual(patch, { image_url: null });
  });

  it('returns empty patch when neither image field is supplied', () => {
    assert.deepEqual(resolveImageR2Patch({}), {});
    assert.deepEqual(resolveImageR2Patch({ name: 'unrelated' }), {});
  });

  it('preserves partial-update semantics: undefined image_r2_key does not touch image_url', () => {
    const patch = resolveImageR2Patch({ image_r2_key: undefined, sku: 'X' });
    assert.equal('image_url' in patch, false);
  });

  it('falls back to image_url when image_r2_key is not provided', () => {
    const patch = resolveImageR2Patch({ image_url: 'parts/photos/legacy.png' });
    assert.deepEqual(patch, { image_url: 'parts/photos/legacy.png' });
  });

  it('image_r2_key takes precedence over image_url when both are provided', () => {
    const patch = resolveImageR2Patch({
      image_r2_key: 'parts/photos/new.jpg',
      image_url: 'parts/photos/old.jpg',
    });
    assert.deepEqual(patch, { image_url: 'parts/photos/new.jpg' });
  });

  it('treats non-string image_r2_key (e.g. number) as no-op', () => {
    // Defensive — controller layer should reject this, but the helper should
    // not crash if a stray number comes through.
    const patch = resolveImageR2Patch({ image_r2_key: 42 });
    assert.deepEqual(patch, {});
  });
});
