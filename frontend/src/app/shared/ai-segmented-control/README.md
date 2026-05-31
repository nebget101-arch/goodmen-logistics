# `<app-ai-segmented-control>` (FN-1636)

Generic segmented button group. Used for the dashboard timeframe
(Today / 7D / 30D / Custom) and reusable on other pages.

## Inputs

| Input         | Type                          | Default               | Notes |
|---------------|-------------------------------|-----------------------|-------|
| `segments`    | `Array<{ key, label }>`       | `[]`                  | Buttons, left to right. |
| `selectedKey` | `string \| null`              | `null`                | Active segment key. |
| `ariaLabel`   | `string`                      | `'Segmented control'` | Group label. |

## Outputs

| Output              | Payload  | Notes |
|---------------------|----------|-------|
| `selectedKeyChange` | `string` | Emits the newly selected key. Supports `[(selectedKey)]`. |

## Behavior

- Active segment uses the flat `.btn-primary` gradient (no glow); inactive use `.btn-secondary`.
- Each button exposes `aria-pressed`; the container is `role="group"`.
- Clicking the already-selected segment is a no-op (no re-emit).

## Example

```html
<app-ai-segmented-control
  [segments]="[{key:'today',label:'Today'},{key:'7d',label:'7D'},{key:'30d',label:'30D'}]"
  [(selectedKey)]="timeframe">
</app-ai-segmented-control>
```
