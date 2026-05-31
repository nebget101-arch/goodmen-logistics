# `<app-status-stepper>`

Horizontal status stepper for Roadside flows. Each step renders an index circle
(or a green check when complete), a meta block (kicker / label / value), and a
connector line between steps. Declared + exported from `SharedModule`.

## Inputs

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `steps` | `StepperStep[]` | `[]` | The ordered list of steps. |
| `activeKey` | `string` | `''` | Key of the step considered "active" (becomes the roving tabindex entry point and gets `aria-current="step"`). |

```ts
interface StepperStep {
  key: string;
  label: string;
  kicker?: string;
  value?: string;
  status: 'pending' | 'current' | 'complete' | 'skipped' | 'blocked';
}
```

## Outputs

| Output | Payload | Description |
| --- | --- | --- |
| `stepChange` | `string` | Emits the step `key` when a reachable step is activated (click / Enter / Space). |

## State matrix

| Status | Visual | A11y |
| --- | --- | --- |
| `pending` | slate border, clickable | focusable when reachable |
| `current` | cyan border + cyan glow ring, cyan label/circle | `aria-current="step"` when active |
| `complete` | green border, green ✓ glyph in circle | focusable |
| `skipped` | label/value `line-through`, slate-dim | focusable |
| `blocked` | dashed slate-600 border | `disabled`, `aria-disabled="true"`, `tabindex="-1"`, not focusable |

## Keyboard

Roving tabindex across **reachable** steps (every status except `blocked`):

- `ArrowRight` / `ArrowDown` → focus next reachable (wraps)
- `ArrowLeft` / `ArrowUp` → focus previous reachable (wraps)
- `Home` / `End` → first / last reachable
- `Enter` / `Space` → emit `stepChange` for the focused step

## Usage

```html
<app-status-stepper
  [steps]="steps"
  [activeKey]="activeKey"
  (stepChange)="activeKey = $event"
></app-status-stepper>
```
