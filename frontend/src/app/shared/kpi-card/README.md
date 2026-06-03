# `<app-kpi-card>` (FN-1636)

Reusable KPI tile for dashboard clusters (fleet health, loads progress, billing).

## Inputs

| Input        | Type                                              | Default | Notes |
|--------------|---------------------------------------------------|---------|-------|
| `label`      | `string`                                          | `''`    | Metric name (uppercased in UI). |
| `value`      | `string \| number`                                | `''`    | Primary value. |
| `subline`    | `string`                                          | `''`    | Optional secondary line. |
| `status`     | `'good' \| 'info' \| 'warning' \| 'critical'`     | `'info'`| Accent strip + hover glow tint. |
| `trend`      | `{ direction: 'up'\|'down'\|'flat', deltaText }`  | `null`  | Optional trend chip. |
| `routerLink` | `string \| unknown[]`                             | `null`  | When set, the whole card becomes an `<a>`. |

## Outputs

None — navigation is delegated to `routerLink`.

## Behavior

- Renders as `<a [routerLink]>` when `routerLink` is set (keyboard-focusable), otherwise a non-interactive `<div role="group">`.
- Hover/focus on a link card lifts `-1px` and adds an 8px outer glow tinted by `status`.
- 3px left accent strip colored by `status`.
- `aria-label` is composed from label, value, subline, and trend (see `composeAriaLabel`).

## Color map

| status     | accent (rgba)            |
|------------|--------------------------|
| `good`     | green `34,197,94`        |
| `info`     | sky `56,189,248`         |
| `warning`  | amber `217,119,6`        |
| `critical` | red `239,68,68`          |

All colors come from the documented dark-theme palette — no new hex values.

## Example

```html
<app-kpi-card
  label="Active Loads"
  [value]="42"
  subline="3 pending pickup"
  status="good"
  [trend]="{ direction: 'up', deltaText: '+12% vs 7d' }"
  routerLink="/loads">
</app-kpi-card>
```
