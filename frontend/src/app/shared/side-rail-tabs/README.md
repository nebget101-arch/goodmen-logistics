# `<app-side-rail-tabs>`

Underlined tab strip with projected content panes. The active tab gets a cyan
underline + cyan text; inactive tabs are slate. Content is projected via
`ng-content`; consumers slot panes with `[data-rail-pane="<key>"]` and the
component shows only the pane whose key equals `activeKey`. Declared + exported
from `SharedModule`.

## Inputs

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `tabs` | `RailTab[]` | `[]` | Tab definitions. |
| `activeKey` | `string` | `''` | Currently selected tab key (two-way friendly). |

```ts
interface RailTab {
  key: string;
  label: string;
  icon?: string; // material-symbols-outlined glyph name
}
```

## Outputs

| Output | Payload | Description |
| --- | --- | --- |
| `activeKeyChange` | `string` | Emitted on tab click; enables `[(activeKey)]`. |

## A11y

- Strip = `role="tablist"`, each tab = `role="tab"` with `aria-selected`.

## Usage

```html
<app-side-rail-tabs [tabs]="tabs" [(activeKey)]="active">
  <div data-rail-pane="timeline">…timeline…</div>
  <div data-rail-pane="location">…location…</div>
</app-side-rail-tabs>
```

Pane visibility is driven imperatively by toggling `style.display` on each
`[data-rail-pane]` element after content init and whenever `activeKey` changes.
