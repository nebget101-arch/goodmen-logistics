import { fitWithin, MAX_LOGO_DIMENSION } from './logo-resize.util';

// FN-1840 — pure aspect-ratio math behind the client-side logo downscaler.
// The DOM-bound parts (canvas/Image/URL) are exercised in the browser; here we
// verify the dimension policy that drives the resize decision.
describe('fitWithin (logo downscale math)', () => {
  it('leaves an image already within bounds untouched', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, resized: false });
  });

  it('treats an image exactly at the cap as within bounds (no resize)', () => {
    expect(fitWithin(1024, 1024)).toEqual({
      width: MAX_LOGO_DIMENSION,
      height: MAX_LOGO_DIMENSION,
      resized: false
    });
  });

  it('downscales a large square to the cap', () => {
    expect(fitWithin(3500, 3500)).toEqual({ width: 1024, height: 1024, resized: true });
  });

  it('preserves aspect ratio for a wide logo', () => {
    // 4000×1000 (4:1) → width capped at 1024, height scaled to 256.
    expect(fitWithin(4000, 1000)).toEqual({ width: 1024, height: 256, resized: true });
  });

  it('preserves aspect ratio for a tall logo', () => {
    // 1000×4000 (1:4) → height capped at 1024, width scaled to 256.
    expect(fitWithin(1000, 4000)).toEqual({ width: 256, height: 1024, resized: true });
  });

  it('resizes when only one axis exceeds the cap', () => {
    const result = fitWithin(2000, 500);
    expect(result.resized).toBe(true);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(256);
  });

  it('never produces a zero dimension for extreme aspect ratios', () => {
    const result = fitWithin(10000, 5);
    expect(result.width).toBe(1024);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('honors a custom max', () => {
    expect(fitWithin(1000, 500, 500)).toEqual({ width: 500, height: 250, resized: true });
  });
});
