import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AiSelectComponent } from './ai-select/ai-select.component';
import { AiDatePickerComponent } from './ai-date-picker/ai-date-picker.component';

@NgModule({
  declarations: [AiSelectComponent, AiDatePickerComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ],
  exports: [AiSelectComponent, AiDatePickerComponent]
})
export class SharedModule {}
