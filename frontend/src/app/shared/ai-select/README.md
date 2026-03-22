# `app-ai-select`

Shared AI-themed dropdown using Angular Material `MatSelect`. Styling aligns with `docs/AI_THEME_VISUAL_REFERENCE.md` (dark surface, 10px radius, cyan focus ring). Panel uses global class `.ai-select-panel` in `styles.css`.

## Usage

**Reactive forms (flat options)**

```html
<app-ai-select
  formControlName="status"
  label="Status"
  [options]="statusOptions"
  placeholder="Choose status"
  [allowEmpty]="true"
  emptyLabel="All"
></app-ai-select>
```

```ts
statusOptions: AiSelectOption<string>[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' }
];
```

**Template-driven with option groups**

```html
<app-ai-select
  [(ngModel)]="selectedCategory"
  name="category"
  label="Category"
  [optionGroups]="categoryGroups"
  placeholder="Select category"
></app-ai-select>
```

```ts
categoryGroups: AiSelectOptionGroup<string>[] = [
  { groupLabel: 'Fleet', options: [{ value: 'vehicles', label: 'Vehicles' }, { value: 'drivers', label: 'Drivers' }] },
  { groupLabel: 'Finance', options: [{ value: 'invoices', label: 'Invoices' }] }
];
```

**Optional inputs**

| Input | Description |
|-------|-------------|
| `label` | Floating label |
| `placeholder` | Placeholder when empty (default "Select...") |
| `options` | Flat `Array<{value, label}>` |
| `optionGroups` | `Array<{groupLabel, options}>` — when set, `options` ignored |
| `allowEmpty` | Show empty/null option |
| `emptyLabel` | Label for empty option |
| `inputId` | DOM id for the select |
| `ariaLabel` | Accessible name when no visible label |

## Search

Search/filter for long lists can be added in a future iteration (e.g. custom panel with filter input).
