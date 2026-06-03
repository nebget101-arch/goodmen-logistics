# `<app-ai-hero-strip>` (FN-1636)

One-line "needs attention" strip. Renders up to three severity chips and
computes a dominant accent from the highest severity present. Built on the
`.ai-panel-flat` utility (top accent border keyed off `data-severity`).

## Inputs

| Input   | Type             | Default | Notes |
|---------|------------------|---------|-------|
| `items` | `HeroItem[]`     | `[]`    | Only the first three are rendered. |

```ts
interface HeroItem {
  severity: 'info' | 'warning' | 'critical';
  count: number;
  label: string;
  routerLink: string | unknown[];
  queryParams?: Params;
}
```

## Content slot

Project a "View all" link (or any action) into the right side:

```html
<app-ai-hero-strip [items]="attention">
  <a heroAction routerLink="/alerts">View all</a>
</app-ai-hero-strip>
```

## Dominant severity

`critical` → red, `warning` → amber, `info` → cyan. When `items` is empty the
strip shows a green **"All systems nominal"** message (`data-severity="good"`).
Computation is order-independent (`dominantSeverity` static helper).

## Color map

| severity   | accent (rgba)      |
|------------|--------------------|
| `info`     | sky `56,189,248`   |
| `warning`  | amber `217,119,6`  |
| `critical` | red `239,68,68`    |
| `good`     | green `34,197,94`  |

All colors come from the documented dark-theme palette — no new hex values.
