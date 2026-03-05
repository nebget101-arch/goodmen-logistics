import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-date-picker',
  templateUrl: './date-picker.component.html',
  styleUrls: ['./date-picker.component.css']
})
export class DatePickerComponent {
  @Input() label = '';
  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() name = '';
  @Input() touchUi = false;
  @Input() startView: 'month' | 'year' | 'multi-year' = 'multi-year';

  private _value: Date | null = null;

  @Input()
  get value(): Date | null {
    return this._value;
  }
  set value(val: Date | null) {
    this._value = val;
    this.valueChange.emit(this._value);
  }

  @Output() valueChange = new EventEmitter<Date | null>();
}

