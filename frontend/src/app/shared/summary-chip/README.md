# `<app-summary-chip>`

Compact confirmation chip with a green tick + green left border, a bold title,
and a single ellipsised detail line. Optionally shows a pencil button that emits
`edit`. Declared + exported from `SharedModule`.

## Inputs

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | `''` | Bold heading line. |
| `detail` | `string` | `''` | Single-line detail (truncated with ellipsis). |
| `editable` | `boolean` | `false` | When `true`, renders the pencil edit button. |

## Outputs

| Output | Payload | Description |
| --- | --- | --- |
| `edit` | `void` | Emitted when the pencil button is clicked. |

## Usage

```html
<app-summary-chip
  title="Pickup confirmed"
  detail="1200 Market St, San Francisco, CA"
  [editable]="true"
  (edit)="onEditPickup()"
></app-summary-chip>
```

The pencil icon uses `material-symbols-outlined` "edit" with `aria-label="Edit"`.
