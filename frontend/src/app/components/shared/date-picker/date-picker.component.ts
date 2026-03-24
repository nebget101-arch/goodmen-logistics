import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatDatepicker } from '@angular/material/datepicker';

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
  @Input() startView: 'month' | 'year' | 'multi-year' = 'month';

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

  setToday(picker: MatDatepicker<Date>): void {
    this.value = new Date();
    picker.close();
  }

  clearDate(picker: MatDatepicker<Date>): void {
    this.value = null;
    picker.close();
  }
}

