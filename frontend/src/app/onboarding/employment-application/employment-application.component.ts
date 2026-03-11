import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Subscription, timer } from 'rxjs';
import { EmploymentApplicationService } from '../../services/employment-application.service';

@Component({
  selector: 'app-employment-application',
  templateUrl: './employment-application.component.html',
  styleUrls: ['./employment-application.component.scss']
})
export class EmploymentApplicationComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  autosaveSub?: Subscription;
  saving = false;

  constructor(private fb: FormBuilder, private api: EmploymentApplicationService) {}

  ngOnInit() {
    this.form = this.fb.group({
      applicant: this.fb.group({
        firstName: ['', Validators.required],
        middleName: [''],
        lastName: ['', Validators.required],
        phone: ['', Validators.required],
        email: ['', [Validators.required]],
        dateOfBirth: [''],
        ssn: [''],
        positionAppliedFor: [''],
        dateAvailableForWork: [''],
        legalRightToWorkInUS: [true]
      }),
      residencies: this.fb.array([]),
      licenses: this.fb.array([]),
      drivingExperience: this.fb.array([]),
      accidents: this.fb.array([]),
      convictions: this.fb.array([]),
      employers: this.fb.array([]),
      education: this.fb.array([]),
      otherQualifications: [''],
      certification: this.fb.group({
        applicantPrintedName: [''],
        applicantSignature: [''],
        signatureDate: [''],
        certificationAccepted: [false]
      })
    });

    // preload some rows
    this.initDefaults();

    // simple autosave every 20s
    this.autosaveSub = timer(20000, 20000).subscribe(() => this.autosave());
  }

  ngOnDestroy() {
    if (this.autosaveSub) this.autosaveSub.unsubscribe();
  }

  get residencies(): FormArray { return this.form.get('residencies') as FormArray; }
  get drivingExperience(): FormArray { return this.form.get('drivingExperience') as FormArray; }
  get employers(): FormArray { return this.form.get('employers') as FormArray; }

  initDefaults() {
    // Residency defaults: Current, Mailing, Previous x3
    const defaults = ['Current','Mailing','Previous','Previous','Previous'];
    defaults.forEach(d => this.residencies.push(this.fb.group({ residencyType: d, street: [''], city: [''], state: [''], zipCode: [''], yearsAtAddress: [''] })));

    // Driving experience defaults
    const drives = ['Straight Truck','Tractor & Semi-Trailer','Tractor & 2 Trailers','Tractor & Tanker','Other'];
    drives.forEach(d => this.drivingExperience.push(this.fb.group({ classOfEquipment: [d], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approximateMilesTotal: [''] })));

    // employers default 3
    for (let i=0;i<3;i++) {
      this.employers.push(this.fb.group({ companyName: [''], phone: [''], address: [''], positionHeld: [''], fromMonthYear: [''], toMonthYear: [''], reasonForLeaving: [''], salary: [''], subjectToFMCSR: [false], safetySensitiveDOTFunction: [false], gapsExplanation: [''] }));
    }
  }

  async autosave() {
    if (this.form.invalid) return;
    this.saving = true;
    try {
      const payload = { applicantSnapshot: this.form.value.applicant, residencies: this.form.value.residencies };
      // TODO: call appropriate create/update API with driverId
      await this.api.saveDraft(payload).toPromise();
    } catch (e) {
      // ignore autosave errors for now
    } finally {
      this.saving = false;
    }
  }

  addResidency() { this.residencies.push(this.fb.group({ residencyType: [''], street: [''], city: [''], state: [''], zipCode: [''], yearsAtAddress: ['']})); }
  addAccident() { (this.form.get('accidents') as FormArray).push(this.fb.group({ date: [''], natureOfAccident: [''], fatalitiesCount: [0], injuriesCount: [0], chemicalSpill: [false] })); }
  addConviction() { (this.form.get('convictions') as FormArray).push(this.fb.group({ dateConvicted: [''], violation: [''], stateOfViolation: [''], penalty: [''] })); }
  addEmployer() { this.employers.push(this.fb.group({ companyName: [''], phone: [''], address: [''], positionHeld: [''], fromMonthYear: [''], toMonthYear: [''], reasonForLeaving: [''], salary: [''], subjectToFMCSR: [false], safetySensitiveDOTFunction: [false], gapsExplanation: [''] })); }

  async submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    // show review then call submit endpoint
  }
}
