# `app-ai-date-picker`

Shared AI-themed date field using Angular Material `MatDatepicker`. Styling aligns with `docs/AI_THEME_VISUAL_REFERENCE.md` (dark surface, 10px radius, cyan focus ring). Calendar popup uses global rules in `styles.css` (`.mat-datepicker-content`).

## Usage

**Reactive forms**

```html
<app-ai-date-picker formControlName="dueDate" label="Due date" placeholder="MM/DD/YYYY"></app-ai-date-picker>
```

**Template-driven**

```html
<app-ai-date-picker [(ngModel)]="selectedDate" name="start" label="Start" [disabled]="readOnly"></app-ai-date-picker>
```

**Optional inputs**

| Input | Description |
|-------|-------------|
| `label` | Floating label |
| `placeholder` | Input placeholder |
| `min` / `max` | `Date` bounds for the picker |
| `startView` | `'month'` \| `'year'` \| `'multi-year'` (default `'month'`) |
| `touchUi` | Full-screen picker on small viewports (Material) |
| `inputId` | DOM id for the input |
| `ariaLabel` | When no `label`, for screen readers |

Form / `ngModel` value: `YYYY-MM-DD` string or `null` (same as native `type="date"`).

## Dependencies

Declared in `AppModule` with `MatDatepickerModule`, `MatNativeDateModule`, `MatFormFieldModule`, `MatInputModule`, `FormsModule`.
