# Toast notifications — `ToastService` + `<app-toast-host>`

App-wide toast notifications. `ToastService` is `providedIn: 'root'`, so it needs
no module declaration. `<app-toast-host>` is declared + exported from
`SharedModule` and mounted once at app root (in `app.component.html`).

## `ToastService`

| Method | Returns | Description |
| --- | --- | --- |
| `success(message)` | `number` (id) | Push a success toast. |
| `error(message)` | `number` (id) | Push an error toast. |
| `info(message)` | `number` (id) | Push an info toast. |
| `dismiss(id)` | `void` | Remove a toast immediately. |
| `toasts$` | `Observable<Toast[]>` | Current toast stack. |

```ts
interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}
```

Toasts auto-dismiss after **4000ms** (`setTimeout`). Ids come from an
incrementing counter.

## `<app-toast-host>`

Fixed top-right stack (high z-index), OnPush, renders via the `async` pipe. Each
toast is color-coded by type (success = green, error = red, info = cyan) and has
a manual `✕` close button calling `dismiss(id)`.

## Usage

```ts
constructor(private toasts: ToastService) {}
save() { this.toasts.success('Saved'); }
```

```html
<!-- once, at app root -->
<app-toast-host></app-toast-host>
```
