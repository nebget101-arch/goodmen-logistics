import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SafetyService } from '../safety.service';

@Component({
  selector: 'app-safety-accident-detail',
  templateUrl: './safety-accident-detail.component.html',
  styleUrls: ['./safety-accident-detail.component.css']
})
export class SafetyAccidentDetailComponent implements OnInit {
  id = '';
  incident: any = null;
  loading = true;
  saving = false;
  error = '';
  saveError = '';

  activeTab = 'summary';
  tabs = [
    { key: 'summary',    label: 'Summary',       icon: 'info' },
    { key: 'scene',      label: 'Scene Details',  icon: 'location_on' },
    { key: 'parties',    label: 'Parties',        icon: 'groups' },
    { key: 'damage',     label: 'Damage / Injury',icon: 'healing' },
    { key: 'documents',  label: 'Documents',      icon: 'folder_open' },
    { key: 'tasks',      label: 'Tasks',          icon: 'checklist' },
    { key: 'claims',     label: 'Linked Claims',  icon: 'description' },
    { key: 'audit',      label: 'Audit Log',      icon: 'history' },
  ];

  // Child data
  parties: any[] = [];
  witnesses: any[] = [];
  notes: any[] = [];
  documents: any[] = [];
  tasks: any[] = [];
  claims: any[] = [];
  auditLog: any[] = [];

  // Inline editing
  editMode = false;
  editForm: any = {};

  // Party / witness forms
  showPartyForm = false;
  partyForm: any = { party_type: 'other' };
  showWitnessForm = false;
  witnessForm: any = {};

  // Note form
  newNote = '';
  noteType = 'general';

  // Document upload
  uploadingDoc = false;
  docType = 'other';
  docFile: File | null = null;

  // Task form
  showTaskForm = false;
  taskForm: any = { status: 'open' };

  // Claim form
  showClaimForm = false;
  claimForm: any = { claim_type: 'auto_liability', status: 'open' };
  savingClaim = false;

  readonly STATUSES = ['open', 'under_review', 'pending_close', 'closed'];
  readonly SEVERITIES = ['critical', 'major', 'minor', 'near_miss'];
  readonly TYPES = ['collision', 'cargo_damage', 'injury', 'property_damage', 'spill', 'near_miss', 'other'];
  readonly PREVENTABILITIES = ['preventable', 'non_preventable', 'undetermined'];
  readonly PARTY_TYPES = ['driver', 'owner', 'passenger', 'pedestrian', 'other'];
  readonly DOC_TYPES = ['photo','dashcam','police_report','driver_statement','witness_statement','repair_estimate','repair_invoice','insurance_correspondence','settlement_release','other'];
  readonly CLAIM_TYPES = ['auto_liability', 'cargo', 'general_liability', 'workers_comp', 'property'];
  readonly NOTE_TYPES = ['general', 'investigation', 'legal', 'insurance'];

  // Option arrays for app-ai-select (value/label pairs)
  private toOptions(arr: readonly string[]): { value: string; label: string }[] {
    return arr.map(v => ({ value: v, label: v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));
  }
  readonly statusOptions = this.toOptions(this.STATUSES);
  readonly severityOptions = this.toOptions(this.SEVERITIES);
  readonly typeOptions = this.toOptions(this.TYPES);
  readonly preventabilityOptions = this.toOptions(this.PREVENTABILITIES);
  readonly partyTypeOptions = this.toOptions(this.PARTY_TYPES);
  readonly docTypeOptions = this.toOptions(this.DOC_TYPES);
  readonly claimTypeOptions = this.toOptions(this.CLAIM_TYPES);
  readonly noteTypeOptions = this.toOptions(this.NOTE_TYPES);

  constructor(private route: ActivatedRoute, private router: Router, private safety: SafetyService) {}

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.loadIncident();
  }

  loadIncident(): void {
    this.loading = true;
    this.safety.getIncident(this.id).subscribe({
      next: (inc) => { this.incident = inc; this.editForm = { ...inc }; this.loading = false; this.loadTab('summary'); },
      error: () => { this.error = 'Incident not found'; this.loading = false; }
    });
  }

  loadTab(tab: string): void {
    this.activeTab = tab;
    if (tab === 'parties' && !this.parties.length) { this.loadParties(); }
    if (tab === 'documents' && !this.documents.length) { this.loadDocuments(); }
    if (tab === 'tasks' && !this.tasks.length) { this.loadTasks(); }
    if (tab === 'claims' && !this.claims.length) { this.loadClaims(); }
    if (tab === 'audit' && !this.auditLog.length) { this.loadAuditLog(); }
  }

  loadParties(): void {
    this.safety.getParties(this.id).subscribe(r => { this.parties = r; });
    this.safety.getWitnesses(this.id).subscribe(r => { this.witnesses = r; });
    this.safety.getNotes(this.id).subscribe(r => { this.notes = r; });
  }
  loadDocuments(): void { this.safety.getDocuments(this.id).subscribe(r => { this.documents = r; }); }
  loadTasks(): void { this.safety.getTasks(this.id).subscribe(r => { this.tasks = r; }); }
  loadClaims(): void { this.safety.getIncidentClaims(this.id).subscribe(r => { this.claims = r; }); }
  loadAuditLog(): void { this.safety.getAuditLog(this.id).subscribe(r => { this.auditLog = r; }); }

  // ─── Editing ──────────────────────────────────────────────────────────────
  startEdit(): void { this.editForm = { ...this.incident }; this.editMode = true; this.saveError = ''; }
  cancelEdit(): void { this.editMode = false; }

  saveEdit(): void {
    this.saving = true;
    this.saveError = '';
    this.safety.updateIncident(this.id, this.editForm).subscribe({
      next: (updated) => { this.incident = updated; this.editMode = false; this.saving = false; },
      error: (err) => { this.saveError = err.error?.error || 'Failed to save'; this.saving = false; }
    });
  }

  closeIncident(): void {
    if (!confirm('Close this incident? It will be marked as closed.')) return;
    this.safety.closeIncident(this.id).subscribe({
      next: () => { this.incident.status = 'closed'; },
      error: () => alert('Failed to close incident')
    });
  }

  // ─── Parties ──────────────────────────────────────────────────────────────
  addParty(): void {
    this.safety.addParty(this.id, this.partyForm).subscribe({
      next: (r) => { this.parties.push(r); this.showPartyForm = false; this.partyForm = { party_type: 'other' }; },
      error: () => alert('Failed to add party')
    });
  }
  deleteParty(partyId: string): void {
    if (!confirm('Remove this party?')) return;
    this.safety.deleteParty(this.id, partyId).subscribe(() => { this.parties = this.parties.filter(p => p.id !== partyId); });
  }
  addWitness(): void {
    this.safety.addWitness(this.id, this.witnessForm).subscribe({
      next: (r) => { this.witnesses.push(r); this.showWitnessForm = false; this.witnessForm = {}; },
      error: () => alert('Failed to add witness')
    });
  }
  deleteWitness(id: string): void {
    if (!confirm('Remove this witness?')) return;
    this.safety.deleteWitness(this.id, id).subscribe(() => { this.witnesses = this.witnesses.filter(w => w.id !== id); });
  }
  addNote(): void {
    if (!this.newNote.trim()) return;
    this.safety.addNote(this.id, { content: this.newNote, note_type: this.noteType }).subscribe({
      next: (r) => { this.notes.unshift(r); this.newNote = ''; },
      error: () => alert('Failed to add note')
    });
  }

  // ─── Documents ────────────────────────────────────────────────────────────
  onDocFileChange(event: Event): void {
    this.docFile = (event.target as HTMLInputElement).files?.[0] || null;
  }
  uploadDoc(): void {
    if (!this.docFile) return;
    this.uploadingDoc = true;
    this.safety.uploadDocument(this.id, this.docFile, this.docType).subscribe({
      next: (r) => { this.documents.unshift(r); this.docFile = null; this.uploadingDoc = false; },
      error: () => { alert('Upload failed'); this.uploadingDoc = false; }
    });
  }
  deleteDoc(docId: string): void {
    if (!confirm('Delete this document?')) return;
    this.safety.deleteDocument(this.id, docId).subscribe(() => { this.documents = this.documents.filter(d => d.id !== docId); });
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────
  addTask(): void {
    this.safety.createTask(this.id, this.taskForm).subscribe({
      next: (r) => { this.tasks.push(r); this.showTaskForm = false; this.taskForm = { status: 'open' }; },
      error: () => alert('Failed to create task')
    });
  }
  completeTask(task: any): void {
    this.safety.updateTask(this.id, task.id, { status: 'completed' }).subscribe({
      next: (r) => { const idx = this.tasks.findIndex(t => t.id === task.id); if (idx > -1) this.tasks[idx] = r; }
    });
  }
  deleteTask(taskId: string): void {
    if (!confirm('Delete this task?')) return;
    this.safety.deleteTask(this.id, taskId).subscribe(() => { this.tasks = this.tasks.filter(t => t.id !== taskId); });
  }

  // ─── Claims ──────────────────────────────────────────────────────────────
  addClaim(): void {
    this.savingClaim = true;
    this.safety.createClaim(this.id, this.claimForm).subscribe({
      next: (r) => { this.claims.push(r); this.showClaimForm = false; this.claimForm = { claim_type: 'auto_liability', status: 'open' }; this.savingClaim = false; },
      error: (err) => { alert(err.error?.error || 'Failed to create claim'); this.savingClaim = false; }
    });
  }
  viewClaim(claimId: string): void { this.router.navigate(['/safety/claims'], { queryParams: { claim: claimId } }); }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  statusClass(s: string): string { return s === 'closed' ? 'badge-closed' : s === 'open' ? 'badge-open' : 'badge-review'; }
  severityClass(s: string): string { return s === 'critical' ? 'sev-critical' : s === 'major' ? 'sev-major' : s === 'minor' ? 'sev-minor' : 'sev-near-miss'; }
  taskStatusClass(s: string): string { return s === 'completed' ? 'task-done' : s === 'overdue' ? 'task-overdue' : 'task-open'; }
  claimStatusClass(s: string): string { return s === 'closed' || s === 'settled' ? 'badge-closed' : s === 'denied' ? 'badge-denied' : 'badge-open'; }

  back(): void { this.router.navigate(['/safety/accidents']); }
}
