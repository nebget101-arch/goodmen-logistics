# `<app-ai-alert-row>` (FN-1636)

Single alert row for the alerts rail. Severity pip + accessible label,
category/message/date, and two `.btn-icon` actions (acknowledge, snooze).

## Inputs

| Input        | Type                                          | Default | Notes |
|--------------|-----------------------------------------------|---------|-------|
| `severity`   | `'good' \| 'info' \| 'warning' \| 'critical'` | `'info'`| Pip color + spoken severity word. |
| `category`   | `string`                                      | `''`    | Short tag, e.g. "Compliance". |
| `message`    | `string`                                      | `''`    | Alert text. |
| `date`       | `string`                                      | `''`    | Display date/time. |
| `routerLink` | `string \| unknown[]`                         | `null`  | When set, the message becomes a link. |

## Outputs

| Output        | Payload | Notes |
|---------------|---------|-------|
| `acknowledge` | `void`  | Check action pressed. |
| `snooze`      | `void`  | Snooze action pressed. |

## Accessibility

- Severity is conveyed by color **and** a visually-hidden `.sr-only` label
  ("Critical alert.", etc.) — color is never the only signal.
- Action buttons carry descriptive `aria-label`s and stop propagation so they
  never trigger the message link.

## Color map

| severity   | pip (rgba)        |
|------------|-------------------|
| `good`     | green `34,197,94` |
| `info`     | sky `56,189,248`  |
| `warning`  | amber `217,119,6` |
| `critical` | red `239,68,68`   |

All colors come from the documented dark-theme palette — no new hex values.

## Example

```html
<app-ai-alert-row
  severity="critical"
  category="Compliance"
  message="HOS violation pending review"
  date="2m ago"
  routerLink="/hos"
  (acknowledge)="ack(alert)"
  (snooze)="snooze(alert)">
</app-ai-alert-row>
```
