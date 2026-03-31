import { Component, OnInit, OnDestroy, ElementRef, HostListener } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, Subscription, timer, of } from 'rxjs';
import { debounceTime, switchMap, catchError, filter, take } from 'rxjs/operators';
import { ActivatedRoute } from '@angular/router';
import { EmploymentApplicationService } from '../../services/employment-application.service';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { environment } from '../../../environments/environment';

interface AddressSuggestion {
  street: string;
  city: string;
  state: string;
  zip: string;
}

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
  private packetId: string | null = null;
  private packetToken: string | null = null;

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

  // Address autocomplete state
  addressSuggestions: { [key: string]: AddressSuggestion[] } = {};
  activeAutocompleteKey: string | null = null;
  private addressInput$ = new Subject<{ key: string; query: string }>();
  private autocompleteSub?: Subscription;

  // US States for dropdowns
  usStates = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
  ];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private api: EmploymentApplicationService,
    private apiService: ApiService,
    private route: ActivatedRoute,
    private oeContext: OperatingEntityContextService,
    private elRef: ElementRef
  ) {}

  ngOnInit() {
    this.driverId = this.route.snapshot.paramMap.get('driverId') || this.route.snapshot.queryParamMap.get('driverId');
    this.packetId = this.route.snapshot.queryParamMap.get('packetId');
    this.packetToken = this.route.snapshot.queryParamMap.get('token');

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
        certificationAccepted: [false, Validators.requiredTrue],
        // FN-535: Auto-populated from form data above; editable by driver
        dateOfBirth: [''],
        ssnLast4: [''],
        driversLicenseNumber: [''],
        stateOfIssue: ['']
      })
    });

    // Add one default license row
    this.addLicense();

    // FN-535: Reactively sync certification section from applicant + license fields
    this.setupCertificationSync();

    // Pre-populate first license entry from driver's most recent license
    this.prefillLicenseFromDriver();

    // Load employer info from operating entity / tenant
    this.loadEmployerInfo();

    // Watch address years for dynamic previous addresses
    this.form.get('currentAddress.yearsAtAddress')?.valueChanges.subscribe(() => this.recalcResidencyYears());

    // Watch current employer from date for dynamic previous employers
    this.form.get('currentEmployer.fromDate')?.valueChanges.subscribe(() => this.recalcEmployerYears());

    // Address autocomplete pipeline
    this.autocompleteSub = this.addressInput$.pipe(
      debounceTime(300),
      filter(({ query }) => query.length >= 3),
      switchMap(({ key, query }) =>
        this.http.get<{ success: boolean; data: AddressSuggestion[] }>(`${environment.apiUrl}/address/autocomplete`, { params: { q: query } }).pipe(
          catchError(() => of({ success: false, data: [] as AddressSuggestion[] }))
        ).pipe(
          switchMap(response => {
            const results = response.data || [];
            this.addressSuggestions[key] = results;
            this.activeAutocompleteKey = results.length > 0 ? key : null;
            return of(null);
          })
        )
      )
    ).subscribe();

    // FN-548: Load existing draft so form state survives page reloads
    this.loadExistingDraft();

    // Autosave every 20s
    this.autosaveSub = timer(20000, 20000).subscribe(() => this.autosave());
  }

  ngOnDestroy() {
    if (this.autosaveSub) this.autosaveSub.unsubscribe();
    if (this.autocompleteSub) this.autocompleteSub.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.dismissAutocomplete();
    }
  }

  // === Address Autocomplete ===
  onAddressInput(key: string, event: Event) {
    const query = (event.target as HTMLInputElement).value;
    if (query.length < 3) {
      this.addressSuggestions[key] = [];
      if (this.activeAutocompleteKey === key) this.activeAutocompleteKey = null;
      return;
    }
    this.addressInput$.next({ key, query });
  }

  selectSuggestion(key: string, suggestion: AddressSuggestion, formGroup: FormGroup, fieldMap: { street: string; city: string; state: string; zip: string }) {
    formGroup.patchValue({
      [fieldMap.street]: suggestion.street,
      [fieldMap.city]: suggestion.city,
      [fieldMap.state]: suggestion.state,
      [fieldMap.zip]: suggestion.zip
    });
    this.addressSuggestions[key] = [];
    this.activeAutocompleteKey = null;
  }

  onAddressKeydown(key: string, event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.addressSuggestions[key] = [];
      this.activeAutocompleteKey = null;
    }
  }

  dismissAutocomplete() {
    this.activeAutocompleteKey = null;
    this.addressSuggestions = {};
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

  // === FN-548: Load Existing Draft ===
  // On page reload, fetch the most recent draft for this driver and restore form state.
  private loadExistingDraft(): void {
    if (!this.driverId) return;

    this.api.getByDriver(this.driverId).pipe(take(1)).subscribe({
      next: (apps: Array<{ id: string; status: string; applicant_snapshot: Record<string, unknown> }>) => {
        if (!apps || !apps.length) return;
        // Pick the most recent draft (backend returns ordered by created_at desc)
        const draft = apps.find((a: { status: string }) => a.status === 'draft') || apps[0];
        if (!draft || draft.status === 'submitted_completed') {
          // Already submitted — mark as submitted so the form stays read-only
          this.submitted = true;
          return;
        }
        this.applicationId = draft.id;
        this.restoreFormFromDraft(draft);
      },
      error: () => {
        // Silently ignore — form starts empty for manual entry
      }
    });
  }

  private restoreFormFromDraft(draft: Record<string, unknown>): void {
    const snapshot = (draft['applicant_snapshot'] || {}) as Record<string, unknown>;

    // Restore applicant info
    const applicant = this.form.get('applicant');
    if (applicant && snapshot) {
      applicant.patchValue({
        firstName: snapshot['firstName'] || '',
        middleName: snapshot['middleName'] || '',
        lastName: snapshot['lastName'] || '',
        phone: snapshot['phone'] || '',
        email: snapshot['email'] || '',
        dateOfBirth: snapshot['dateOfBirth'] || '',
        ssn: snapshot['ssn'] ? '***masked***' : '',
        positionAppliedFor: snapshot['positionAppliedFor'] || '',
        dateOfApplication: snapshot['dateOfApplication'] || ''
      }, { emitEvent: false });

      // Restore raw SSN for masking display
      if (snapshot['ssn']) {
        this.ssnRawValue = snapshot['ssn'] as string;
        applicant.get('ssn')?.setValue(this.ssnRawValue, { emitEvent: false });
      }
    }

    // Restore work authorization
    const wa = snapshot['workAuthorization'] as Record<string, unknown> | null;
    if (wa) {
      this.form.get('workAuthorization')?.patchValue(wa, { emitEvent: false });
    }

    // Restore drug/alcohol
    const da = snapshot['drugAlcohol'] as Record<string, unknown> | null;
    if (da) {
      this.form.get('drugAlcohol')?.patchValue(da, { emitEvent: false });
    }

    // Restore accidents/violations flags
    if (snapshot['hasAccidents']) {
      this.form.get('hasAccidents')?.setValue(snapshot['hasAccidents'], { emitEvent: false });
    }
    if (snapshot['hasViolations']) {
      this.form.get('hasViolations')?.setValue(snapshot['hasViolations'], { emitEvent: false });
    }

    // Restore licenses from draft snapshot
    const savedLicenses = (snapshot['licenses'] || draft['licenses'] || []) as any[];
    if (Array.isArray(savedLicenses) && savedLicenses.length > 0) {
      this.licenses.clear();
      for (const lic of savedLicenses) {
        this.licenses.push(this.fb.group({
          state: [lic.state || '', Validators.required],
          licenseNumber: [lic.licenseNumber || lic.license_number || '', Validators.required],
          type: [lic.type || 'CDL-A', Validators.required],
          expirationDate: [lic.expirationDate || lic.expiration_date || '', Validators.required]
        }));
      }
    }

    // Re-sync certification fields after restoring form data
    this.syncCertificationNow();
  }

  // === FN-535: Certification Auto-Population ===
  // Reactively mirrors applicant + license data into the certification section
  // so drivers don't have to re-type information already entered above.
  private setupCertificationSync(): void {
    const cert = this.form.get('certification');
    if (!cert) return;

    const buildFullName = () => {
      const a = this.form.get('applicant')?.value || {};
      return [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ');
    };

    // Sync full name to applicantPrintedName and applicantSignature
    ['applicant.firstName', 'applicant.middleName', 'applicant.lastName'].forEach(field => {
      this.form.get(field)?.valueChanges.subscribe(() => {
        const name = buildFullName();
        cert.get('applicantPrintedName')?.setValue(name, { emitEvent: false });
        cert.get('applicantSignature')?.setValue(name, { emitEvent: false });
      });
    });

    // Sync DOB
    this.form.get('applicant.dateOfBirth')?.valueChanges.subscribe(dob => {
      cert.get('dateOfBirth')?.setValue(dob || '', { emitEvent: false });
    });

    // Sync license number + state from first license row
    // Re-subscribe whenever licenses array changes (e.g., after draft restore)
    const syncFirstLicense = () => {
      const firstLicense = this.licenses.at(0) as FormGroup | undefined;
      if (!firstLicense) return;
      firstLicense.get('licenseNumber')?.valueChanges.subscribe(val => {
        cert.get('driversLicenseNumber')?.setValue(val || '', { emitEvent: false });
      });
      firstLicense.get('state')?.valueChanges.subscribe(val => {
        cert.get('stateOfIssue')?.setValue(val || '', { emitEvent: false });
      });
    };
    syncFirstLicense();
    this.licenses.valueChanges.subscribe(() => syncFirstLicense());

    // FN-546 fix 2: SSN Last 4 subscription was missing entirely — wire it now
    this.form.get('applicant.ssn')?.valueChanges.subscribe(() => {
      const last4 = this.ssnRawValue.slice(-4);
      cert.get('ssnLast4')?.setValue(last4 || '', { emitEvent: false });
    });

    // FN-546 fix 1: do an immediate one-time sync so values already in the form
    // populate certification without requiring the user to re-type them
    this.syncCertificationNow();
  }

  // FN-546: one-time snapshot of current form values into the certification section
  private syncCertificationNow(): void {
    const cert = this.form.get('certification');
    if (!cert) return;
    const a = this.form.get('applicant')?.value || {};
    const name = [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ');
    if (name) {
      cert.get('applicantPrintedName')?.setValue(name, { emitEvent: false });
      cert.get('applicantSignature')?.setValue(name, { emitEvent: false });
    }
    if (a.dateOfBirth) {
      cert.get('dateOfBirth')?.setValue(a.dateOfBirth, { emitEvent: false });
    }
    const last4 = this.ssnRawValue.slice(-4);
    if (last4) {
      cert.get('ssnLast4')?.setValue(last4, { emitEvent: false });
    }
    const lic = this.licenses.at(0) as FormGroup | undefined;
    if (lic?.get('licenseNumber')?.value) {
      cert.get('driversLicenseNumber')?.setValue(lic.get('licenseNumber')!.value, { emitEvent: false });
    }
    if (lic?.get('state')?.value) {
      cert.get('stateOfIssue')?.setValue(lic.get('state')!.value, { emitEvent: false });
    }
  }

  // === License Pre-fill (FN-532: use public endpoint, not auth-protected) ===
  private prefillLicenseFromDriver(): void {
    if (!this.packetId || !this.packetToken) return;

    const publicBase = environment.apiUrl.replace(/\/api\/?$/, '/public/onboarding');
    this.http.get<{ licenseNumber?: string; licenseState?: string }>(
      `${publicBase}/${this.packetId}/license`,
      { params: { token: this.packetToken } }
    ).pipe(take(1)).subscribe({
      next: (data) => {
        if (!data) return;

        const firstLicense = this.licenses.at(0) as FormGroup | undefined;
        if (!firstLicense) return;

        if (data.licenseNumber && !firstLicense.get('licenseNumber')?.value) {
          firstLicense.get('licenseNumber')?.setValue(data.licenseNumber);
        }
        if (data.licenseState && !firstLicense.get('state')?.value) {
          firstLicense.get('state')?.setValue(data.licenseState);
        }
        // FN-546: re-sync certification after license prefill so DL# and State populate
        this.syncCertificationNow();
      },
      error: () => {
        // Silently skip — section remains blank for manual entry
      }
    });
  }

  // === SSN Masking ===
  // FN-531: [value]="getSsnDisplay()" was removed from the template — Angular's one-way
  // property binding resets input.value on every CD cycle, fighting the browser and causing
  // each keypress to appear to wipe the field. We now own the DOM value entirely here.
  onSsnInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const raw = input.value;

    // Each '*' in the display represents a preserved hidden digit from ssnRawValue.
    // Count '*' chars (= number of masked prefix digits to keep), then extract only
    // the visible (non-mask, non-dash) digit chars typed by the user.
    const maskCount = (raw.match(/\*/g) ?? []).length;
    const visibleDigits = raw.replace(/[^\d]/g, '');

    if (maskCount > 0) {
      // Preserve the first `maskCount` raw digits; append newly-typed visible digits
      const preservedPrefix = this.ssnRawValue.slice(0, maskCount);
      this.ssnRawValue = (preservedPrefix + visibleDigits).slice(0, 9);
    } else {
      // No mask chars — user cleared the field or pasted plain digits
      this.ssnRawValue = visibleDigits.slice(0, 9);
    }

    // Store sanitised value in form control
    this.form.get('applicant.ssn')?.setValue(this.ssnRawValue, { emitEvent: false });

    // FN-535: Keep certification.ssnLast4 in sync
    this.form.get('certification.ssnLast4')?.setValue(
      this.ssnRawValue.length >= 4 ? this.ssnRawValue.slice(-4) : '',
      { emitEvent: false }
    );

    // FN-531: Imperatively update the input display value so Angular CD never touches it.
    // Place cursor at end — standard behaviour for a masked SSN field.
    const display = this.getSsnDisplay();
    input.value = display;
    input.setSelectionRange(display.length, display.length);
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
      operatingEntityId: this.oeContext.getSelectedOperatingEntityId(),
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
        this.storeSessionDataForConsentForms();
      }
    } catch (e: any) {
      alert('Submission failed: ' + (e?.error?.error || e?.message || 'Unknown error'));
    } finally {
      this.submitting = false;
    }
  }

  private storeSessionDataForConsentForms(): void {
    try {
      const applicant = this.form.get('applicant')?.value || {};
      const licenses = this.form.get('licenses') as FormArray;
      const firstLicense = licenses?.length > 0 ? licenses.at(0).value : {};

      const sessionData = {
        fullName: `${applicant.firstName || ''} ${applicant.middleName || ''} ${applicant.lastName || ''}`.replace(/\s+/g, ' ').trim(),
        dateOfBirth: applicant.dateOfBirth || '',
        ssnLast4: (this.ssnRawValue || '').slice(-4),
        driversLicenseNumber: firstLicense.licenseNumber || '',
        stateOfIssue: firstLicense.state || ''
      };

      sessionStorage.setItem('fn_onboarding_applicant', JSON.stringify(sessionData));
    } catch {
      // Silently ignore if sessionStorage is unavailable
    }
  }
}
