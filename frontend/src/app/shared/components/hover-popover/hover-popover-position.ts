/**
 * Pure positioning helpers for HoverPopoverComponent.
 * Extracted so the collision-avoidance math is unit-testable without a DOM.
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right';
export type PreferredPlacement = 'auto' | Placement;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
  placement: Placement;
}

export interface CalculateOptions {
  preferredPlacement?: PreferredPlacement;
  /** Gap between trigger and popover in px. */
  offset?: number;
  /** Minimum distance to keep from viewport edges in px. */
  margin?: number;
}

const DEFAULT_OFFSET = 6;
const DEFAULT_MARGIN = 8;

/**
 * Compute viewport-clamped coordinates for a popover anchored to a trigger rect.
 *
 * Algorithm:
 *   1. Decide placement (preferred; fall back to the side with the most free space).
 *   2. Project the popover rect onto that side of the trigger.
 *   3. Clamp the resulting rect inside the viewport (minus margin) so it never clips.
 */
export function calculatePopoverPosition(
  trigger: Rect,
  popover: Size,
  viewport: Viewport,
  options: CalculateOptions = {}
): PopoverPosition {
  const offset = options.offset ?? DEFAULT_OFFSET;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const preferred: PreferredPlacement = options.preferredPlacement ?? 'auto';

  const placement = resolvePlacement(trigger, popover, viewport, preferred, offset, margin);
  const raw = project(trigger, popover, placement, offset);
  return {
    top: clamp(raw.top, margin, viewport.height - popover.height - margin),
    left: clamp(raw.left, margin, viewport.width - popover.width - margin),
    placement
  };
}

function resolvePlacement(
  trigger: Rect,
  popover: Size,
  viewport: Viewport,
  preferred: PreferredPlacement,
  offset: number,
  margin: number
): Placement {
  const fits: Record<Placement, boolean> = {
    top: trigger.top - offset - margin >= popover.height,
    bottom: viewport.height - (trigger.top + trigger.height) - offset - margin >= popover.height,
    left: trigger.left - offset - margin >= popover.width,
    right: viewport.width - (trigger.left + trigger.width) - offset - margin >= popover.width
  };

  if (preferred !== 'auto' && fits[preferred]) {
    return preferred;
  }

  const autoOrder: Placement[] = ['bottom', 'top', 'right', 'left'];
  const searchOrder: Placement[] =
    preferred === 'auto' ? autoOrder : [preferred, ...autoOrder.filter((p) => p !== preferred)];

  for (const candidate of searchOrder) {
    if (fits[candidate]) return candidate;
  }

  // Nothing fits: pick the side with the most free space so the final clamp
  // produces the smallest overlap with the trigger.
  const space: Record<Placement, number> = {
    top: trigger.top,
    bottom: viewport.height - (trigger.top + trigger.height),
    left: trigger.left,
    right: viewport.width - (trigger.left + trigger.width)
  };
  return (Object.entries(space).sort((a, b) => b[1] - a[1])[0][0]) as Placement;
}

function project(trigger: Rect, popover: Size, placement: Placement, offset: number): { top: number; left: number } {
  const triggerCenterX = trigger.left + trigger.width / 2;
  const triggerCenterY = trigger.top + trigger.height / 2;

  switch (placement) {
    case 'top':
      return {
        top: trigger.top - popover.height - offset,
        left: triggerCenterX - popover.width / 2
      };
    case 'bottom':
      return {
        top: trigger.top + trigger.height + offset,
        left: triggerCenterX - popover.width / 2
      };
    case 'left':
      return {
        top: triggerCenterY - popover.height / 2,
        left: trigger.left - popover.width - offset
      };
    case 'right':
      return {
        top: triggerCenterY - popover.height / 2,
        left: trigger.left + trigger.width + offset
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
