import { Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** Single option for flat list or inside a group. */
export interface AiSelectOption<T = string | number> {
  value: T;
  label: string;
}

/** Option group for categorized options. */
export interface AiSelectOptionGroup<T = string | number> {
  groupLabel: string;
  options: AiSelectOption<T>[];
}

/**
 * AI-themed dropdown backed by Angular Material Select.
 * Implements ControlValueAccessor — use with reactive forms or template-driven ngModel.
 */
@Component({
  selector: 'app-ai-select',
  templateUrl: './ai-select.component.html',
  styleUrls: ['./ai-select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AiSelectComponent),
      multi: true
    }
  ]
})
export class AiSelectComponent<T = string | number> implements ControlValueAccessor {
  @Input() label = '';
  @Input() placeholder = 'Select...';
  @Input() name = '';
  @Input() inputId = '';
  @Input() ariaLabel = '';

  /** Flat list of options. Ignored when optionGroups is set. */
  @Input() options: AiSelectOption<T>[] = [];

  /** Grouped options. When set, options input is ignored. */
  @Input() optionGroups: AiSelectOptionGroup<T>[] = [];

  /** Whether to show a clear/empty option. */
  @Input() allowEmpty = false;

  /** Placeholder for the empty option (e.g. "All" or "None"). */
  @Input() emptyLabel = '';

  private _disabled = false;

  @Input()
  set disabled(v: boolean) {
    this._disabled = !!v;
  }
  get disabled(): boolean {
    return this._disabled;
  }

  value: T | null = null;

  private onChange: (v: T | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(obj: T | null): void {
    this.value = obj ?? null;
  }

  registerOnChange(fn: (v: T | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled = isDisabled;
  }

  onSelectionChange(v: T | null): void {
    this.value = v;
    this.onChange(v);
  }

  onBlur(): void {
    this.onTouched();
  }

  /** Flat options for template (either from options or flattened from groups). */
  get flatOptions(): AiSelectOption<T>[] {
    if (this.optionGroups?.length) {
      return this.optionGroups.flatMap((g) => g.options);
    }
    return this.options ?? [];
  }

  /** Whether we're using groups. */
  get hasGroups(): boolean {
    return !!(this.optionGroups?.length);
  }
}
