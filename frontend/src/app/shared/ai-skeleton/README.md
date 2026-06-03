# `<app-ai-skeleton>` (FN-1636)

Shimmer placeholder for loading states. Replaces the bespoke orbital-loader
on the dashboard and is reusable everywhere else.

## Inputs

| Input    | Type               | Default   | Notes |
|----------|--------------------|-----------|-------|
| `width`  | `string \| number` | `'100%'`  | Bare numbers → px. |
| `height` | `string \| number` | `'16px'`  | Bare numbers → px. |
| `radius` | `string \| number` | `'8px'`   | Bare numbers → px. |

## Outputs

None.

## Accessibility

- Host carries `role="status"`, `aria-busy="true"`, `aria-label="Loading"`.
- Animation is disabled under `prefers-reduced-motion: reduce`.

## Example

```html
<app-ai-skeleton width="100%" height="40px"></app-ai-skeleton>
<app-ai-skeleton [width]="120" [height]="120" [radius]="12"></app-ai-skeleton>
```
