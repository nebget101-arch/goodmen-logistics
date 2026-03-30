import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Subscription, timer, take } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { EmploymentApplicationService } from '../../services/employment-application.service';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-employment-application',
  templateUrl: './employment-application.component.html',
  styleUrls: ['./employment-application.component.scss']
})
export class EmploymentApplicationComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  autosaveSub?: Subscription;
  saving = false;
  submitting = false;
  submitted = false;
  applicationId: string | null = null;
  driverId: string | null = null;

  // Employer info from tenant/operating entity
  employerName = '';
  employerAddress = '';
  employerCity = '';
  employerState = '';
  employerZip = '';

  // SSN masking
  ssnRawValue = '';

  // Dynamic address tracking
  totalResidencyYears = 0;
  needMoreAddresses = true;

  // Dynamic employer tracking
  totalEmployerYears = 0;
  needMoreEmployers = true;

  // US States for dropdowns
  usStates = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
  ];

  constructor(
    private fb: FormBuilder,
    private api: EmploymentApplicationService,
    private apiService: ApiService,
    private route: ActivatedRoute,
    private oeContext: OperatingEntityContextService
  ) {}

  ngOnInit() {
    this.driverId = this.route.snapshot.paramMap.get('driverId') || this.route.snapshot.queryParamMap.get('driverId');

    this.form = this.fb.group({
      applicant: this.fb.group({
        firstName: ['', Validators.required],
        middleName: [''],
        lastName: ['', Validators.required],
        phone: ['', Validators.required],
        email: ['', [Validators.required, Validators.email]],
        dateOfBirth: ['', Validators.required],
        ssn: ['', Validators.required],
        positionAppliedFor: ['', Validators.required],
        dateOfApplication: [new Date().toISOString().slice(0, 10)]
      }),

      // Current address + dynamic previous addresses
      currentAddress: this.fb.group({
        street: ['', Validators.required],
        city: ['', Validators.required],
        state: ['', Validators.required],
        zip: ['', Validators.required],
        yearsAtAddress: ['', Validators.required]
      }),
      previousAddresses: this.fb.array([]),

      // Work Authorization & Criminal Background
      workAuthorization: this.fb.group({
        legallyAuthorizedToWork: ['', Validators.required],
        convictedOfFelony: ['', Validators.required],
        felonyDetails: [''],
        unableToPerformFunctions: ['', Validators.required],
        adaDetails: ['']
      }),

      // Employment History - single consolidated section
      currentEmployer: this.fb.group({
        employerName: ['', Validators.required],
        streetAddress: ['', Validators.required],
        city: ['', Validators.required],
        state: ['', Validators.required],
        zipCode: ['', Validators.required],
        positionHeld: ['', Validators.required],
        fromDate: ['', Validators.required],
        toDate: [''],
        contactPerson: ['', Validators.required],
        phoneNumber: ['', Validators.required],
        salaryWage: [''],
        reasonForLeaving: ['', Validators.required]
      }),
      previousEmployers: this.fb.array([]),

      // Accident Record
      hasAccidents: ['no'],
      accidents: this.fb.array([]),

      // Traffic Violations
      hasViolations: ['no'],
      violations: this.fb.array([]),

      // License History
      licenses: this.fb.array([]),

      // Driving Experience (questionnaire format)
      drivingExperience: this.fb.group({
        straightTruck: this.fb.group({ hasExperience: [false], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approxMiles: [''] }),
        tractorSemiTrailer: this.fb.group({ hasExperience: [false], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approxMiles: [''] }),
        tractorTwoTrailers: this.fb.group({ hasExperience: [false], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approxMiles: [''] }),
        motorcoachSchoolBus: this.fb.group({ hasExperience: [false], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approxMiles: [''] }),
        motorcoachSchoolBusMore15: this.fb.group({ hasExperience: [false], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approxMiles: [''] }),
        other: this.fb.group({ hasExperience: [false], description: [''], typeOfEquipment: [''], dateFrom: [''], dateTo: [''], approxMiles: [''] }),
        statesOperatedIn: ['']
      }),

      // Drug and Alcohol Information
      drugAlcohol: this.fb.group({
        violatedSubstanceProhibitions: ['', Validators.required],
        failedRehabProgram: ['', Validators.required],
        alcoholTestResult04OrHigher: ['', Validators.required],
        positiveControlledSubstancesTest: ['', Validators.required],
        refusedRequiredTest: ['', Validators.required],
        otherDOTViolation: ['', Validators.required]
      }),

      // Certification
      certification: this.fb.group({
        applicantPrintedName: ['', Validators.required],
        applicantSignature: ['', Validators.required],
        signatureDate: [new Date().toISOString().slice(0, 10), Validators.required],
        certificationAccepted: [false, Validators.requiredTrue]
      })
    });

    // Add one default license row
    this.addLicense();

    // Pre-populate first license entry from driver's most recent license
    this.prefillLicenseFromDriver();

    // Load employer info from operating entity / tenant
    this.loadEmployerInfo();

    // Watch address years for dynamic previous addresses
    this.form.get('currentAddress.yearsAtAddress')?.valueChanges.subscribe(() => this.recalcResidencyYears());

    // Watch current employer from date for dynamic previous employers
    this.form.get('currentEmployer.fromDate')?.valueChanges.subscribe(() => this.recalcEmployerYears());

    // Autosave every 20s
    this.autosaveSub = timer(20000, 20000).subscribe(() => this.autosave());
  }

  ngOnDestroy() {
    if (this.autosaveSub) this.autosaveSub.unsubscribe();
  }

  // === Form Array Getters ===
  get previousAddresses(): FormArray { return this.form.get('previousAddresses') as FormArray; }
  get previousEmployers(): FormArray { return this.form.get('previousEmployers') as FormArray; }
  get accidents(): FormArray { return this.form.get('accidents') as FormArray; }
  get violations(): FormArray { return this.form.get('violations') as FormArray; }
  get licenses(): FormArray { return this.form.get('licenses') as FormArray; }

  // === Employer Info ===
  loadEmployerInfo() {
    try {
      const state = this.oeContext.snapshot;
      const oe = state?.selectedOperatingEntity || null;
      if (oe) {
        // Multi-tenant: use operating entity
        this.employerName = oe.name || '';
        // OE only has name/id/mcNumber/dotNumber; address comes from API if needed
      }
      // Try to get more info from API
      if (!this.employerName) {
        const entities = state?.accessibleOperatingEntities || [];
        if (entities.length > 0) {
          this.employerName = entities[0].name || '';
        }
      }
    } catch {
      // If service not available, leave blank
    }
  }

  // === License Pre-fill ===
  private prefillLicenseFromDriver(): void {
    if (!this.driverId) return;

    this.apiService.getDriver(this.driverId).pipe(take(1)).subscribe({
      next: (driver: Record<string, unknown>) => {
        if (!driver) return;

        const firstLicense = this.licenses.at(0) as FormGroup | undefined;
        if (!firstLicense) return;

        // Only patch fields that the user hasn't already typed into
        const cdlNumber = driver['cdlNumber'] as string | undefined;
        const cdlState = driver['cdlState'] as string | undefined;

        if (cdlNumber && !firstLicense.get('licenseNumber')?.value) {
          firstLicense.get('licenseNumber')?.setValue(cdlNumber);
        }
        if (cdlState && !firstLicense.get('state')?.value) {
          firstLicense.get('state')?.setValue(cdlState);
        }
      },
      error: () => {
        // Silently skip — section remains blank for manual entry
      }
    });
  }

  // === SSN Masking ===
  onSsnInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const raw = input.value;

    // Each '*' in the display represents a preserved hidden digit from ssnRawValue.
    // Extracting /\D/g would strip '*' too — losing those stored digits.
    // Instead: count '*' chars (= number of preserved prefix digits to keep),
    // then extract only actual visible digit chars (not '*' or '-').
    const maskCount = (raw.match(/\*/g) ?? []).length;
    const visibleDigits = raw.replace(/[^\d]/g, '');

    if (maskCount > 0) {
      // Preserve the first `maskCount` raw digits; append the visible (unmasked) digits
      const preservedPrefix = this.ssnRawValue.slice(0, maskCount);
      this.ssnRawValue = (preservedPrefix + visibleDigits).slice(0, 9);
    } else {
      // No masking chars — user cleared the field or pasted plain digits
      this.ssnRawValue = visibleDigits.slice(0, 9);
    }

    // Store sanitised value in form control
    this.form.get('applicant.ssn')?.setValue(this.ssnRawValue, { emitEvent: false });
  }

  getSsnDisplay(): string {
    if (!this.ssnRawValue) return '';
    const d = this.ssnRawValue;
    if (d.length <= 3) return '*'.repeat(d.length);
    if (d.length <= 5) return `***-${'*'.repeat(d.length - 3)}`;
    return `***-**-${d.slice(5)}`;
  }

  // === Dynamic Address Logic ===
  recalcResidencyYears() {
    let total = parseFloat(this.form.get('currentAddress.yearsAtAddress')?.value) || 0;
    for (const ctrl of this.previousAddresses.controls) {
      total += parseFloat((ctrl as FormGroup).get('yearsAtAddress')?.value) || 0;
    }
    this.totalResidencyYears = total;
    this.needMoreAddresses = total < 3;

    // Auto-add a previous address section if needed and none exist
    if (this.needMoreAddresses && this.previousAddresses.length === 0 && total > 0 && total < 3) {
      this.addPreviousAddress();
    }
  }

  addPreviousAddress() {
    const group = this.fb.group({
      street: ['', Validators.required],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: ['', Validators.required],
      yearsAtAddress: ['', Validators.required]
    });
    group.get('yearsAtAddress')?.valueChanges.subscribe(() => this.recalcResidencyYears());
    this.previousAddresses.push(group);
  }

  removePreviousAddress(i: number) {
    this.previousAddresses.removeAt(i);
    this.recalcResidencyYears();
  }

  // === Dynamic Employer Logic ===
  recalcEmployerYears() {
    let total = 0;
    const fromDate = this.form.get('currentEmployer.fromDate')?.value;
    if (fromDate) {
      const [mm, yyyy] = (fromDate as string).split('/');
      if (mm && yyyy) {
        const start = new Date(parseInt(yyyy), parseInt(mm) - 1);
        const now = new Date();
        total += (now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      }
    }
    for (const ctrl of this.previousEmployers.controls) {
      const g = ctrl as FormGroup;
      const from = g.get('fromDate')?.value;
      const to = g.get('toDate')?.value;
      if (from && to) {
        const [fmm, fyyyy] = from.split('/');
        const [tmm, tyyyy] = to.split('/');
        if (fmm && fyyyy && tmm && tyyyy) {
          const s = new Date(parseInt(fyyyy), parseInt(fmm) - 1);
          const e = new Date(parseInt(tyyyy), parseInt(tmm) - 1);
          total += (e.getTime() - s.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        }
      }
    }
    this.totalEmployerYears = total;
    this.needMoreEmployers = total < 3;

    if (this.needMoreEmployers && this.previousEmployers.length === 0 && total > 0 && total < 3) {
      this.addPreviousEmployer();
    }
  }

  addPreviousEmployer() {
    const group = this.fb.group({
      employerName: ['', Validators.required],
      streetAddress: ['', Validators.required],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zipCode: ['', Validators.required],
      positionHeld: ['', Validators.required],
      fromDate: ['', Validators.required],
      toDate: ['', Validators.required],
      contactPerson: ['', Validators.required],
      phoneNumber: ['', Validators.required],
      salaryWage: [''],
      reasonForLeaving: ['', Validators.required],
      wasCMV: [false]
    });
    group.get('fromDate')?.valueChanges.subscribe(() => this.recalcEmployerYears());
    group.get('toDate')?.valueChanges.subscribe(() => this.recalcEmployerYears());
    this.previousEmployers.push(group);
  }

  removePreviousEmployer(i: number) {
    this.previousEmployers.removeAt(i);
    this.recalcEmployerYears();
  }

  // === Accident Records ===
  onHasAccidentsChange(val: string) {
    this.form.get('hasAccidents')?.setValue(val);
    if (val === 'yes' && this.accidents.length === 0) {
      this.addAccident();
    }
    if (val === 'no') {
      this.accidents.clear();
    }
  }

  addAccident() {
    this.accidents.push(this.fb.group({
      date: ['', Validators.required],
      natureOfAccident: ['', Validators.required],
      fatalities: ['0'],
      injuries: ['0'],
      hazardousMaterialSpill: [false]
    }));
  }

  removeAccident(i: number) { this.accidents.removeAt(i); }

  // === Traffic Violations ===
  onHasViolationsChange(val: string) {
    this.form.get('hasViolations')?.setValue(val);
    if (val === 'yes' && this.violations.length === 0) {
      this.addViolation();
    }
    if (val === 'no') {
      this.violations.clear();
    }
  }

  addViolation() {
    this.violations.push(this.fb.group({
      location: ['', Validators.required],
      date: ['', Validators.required],
      charge: ['', Validators.required],
      penalty: ['', Validators.required]
    }));
  }

  removeViolation(i: number) { this.violations.removeAt(i); }

  // === Licenses ===
  addLicense() {
    this.licenses.push(this.fb.group({
      state: ['', Validators.required],
      licenseNumber: ['', Validators.required],
      type: ['', Validators.required],
      expirationDate: ['', Validators.required]
    }));
  }

  removeLicense(i: number) { this.licenses.removeAt(i); }

  // === Autosave ===
  async autosave() {
    if (this.submitted) return;
    this.saving = true;
    try {
      const payload = this.buildPayload();
      if (this.applicationId) {
        await this.api.updateDraft(this.applicationId, payload).toPromise();
      } else {
        const result: any = await this.api.saveDraft({ ...payload, driverId: this.driverId }).toPromise();
        if (result?.id) this.applicationId = result.id;
      }
    } catch {
      // ignore autosave errors
    } finally {
      this.saving = false;
    }
  }

  buildPayload() {
    const v = this.form.value;
    return {
      applicantSnapshot: {
        ...v.applicant,
        ssn: this.ssnRawValue // store full SSN
      },
      residencies: [
        { residencyType: 'Current', ...v.currentAddress },
        ...v.previousAddresses.map((a: any, i: number) => ({ residencyType: `Previous ${i + 1}`, ...a }))
      ],
      workAuthorization: v.workAuthorization,
      currentEmployer: v.currentEmployer,
      employers: [
        { ...v.currentEmployer, isCurrent: true },
        ...v.previousEmployers
      ],
      hasAccidents: v.hasAccidents,
      accidents: v.accidents,
      hasViolations: v.hasViolations,
      violations: v.violations,
      licenses: v.licenses,
      drivingExperience: v.drivingExperience,
      drugAlcohol: v.drugAlcohol,
      certification: v.certification
    };
  }

  // === Submit ===
  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Scroll to first invalid field
      setTimeout(() => {
        const el = document.querySelector('.ng-invalid:not(form):not(div)');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }

    this.submitting = true;
    try {
      // Save draft first
      const payload = this.buildPayload();
      if (!this.applicationId) {
        const result: any = await this.api.saveDraft({ ...payload, driverId: this.driverId }).toPromise();
        if (result?.id) this.applicationId = result.id;
      } else {
        await this.api.updateDraft(this.applicationId, payload).toPromise();
      }

      // Submit (triggers PDF generation + R2 upload + DQF update)
      if (this.applicationId) {
        await this.api.submit(this.applicationId).toPromise();
        this.submitted = true;
      }
    } catch (e: any) {
      alert('Submission failed: ' + (e?.error?.error || e?.message || 'Unknown error'));
    } finally {
      this.submitting = false;
    }
  }
}
