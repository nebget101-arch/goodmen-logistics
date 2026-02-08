import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-drivers',
  templateUrl: './drivers.component.html',
  styleUrls: ['./drivers.component.css']
})
export class DriversComponent implements OnInit {
  drivers: any[] = [];
  loading = true;
  showAddForm = false;
  editingDriver: any = null;
  showDQFForm = false;
  selectedDriver: any = null;
  uploadingFile = false;
  
  newDriver: any = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    cdlNumber: '',
    cdlState: '',
    cdlClass: 'A',
    endorsements: [],
    cdlExpiry: '',
    medicalCertExpiry: '',
    hireDate: '',
    address: '',
    dateOfBirth: '',
    clearinghouseStatus: 'eligible'
  };
  
  dqfForm: any = {
    applicationComplete: false,
    mvrComplete: false,
    roadTestComplete: false,
    medicalCertComplete: false,
    annualReviewComplete: false,
    clearinghouseConsentComplete: false,
    notes: ''
  };
  
  driverDocuments: any[] = [];
  uploadingDocuments: { [key: string]: boolean } = {};
  
  saving = false;

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadDrivers();
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetForm();
    }
  }

  resetForm(): void {
    this.newDriver = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      cdlNumber: '',
      cdlState: '',
      cdlClass: 'A',
      endorsements: [],
      cdlExpiry: '',
      medicalCertExpiry: '',
      hireDate: '',
      address: '',
      dateOfBirth: '',
      clearinghouseStatus: 'eligible'
    };
  }

  addDriver(): void {
    if (!this.validateDriver()) {
      alert('Please fill in all required fields');
      return;
    }

    this.saving = true;
    this.apiService.createDriver(this.newDriver).subscribe({
      next: (driver) => {
        this.drivers.unshift(driver);
        this.showAddForm = false;
        this.resetForm();
        this.saving = false;
        alert('Driver added successfully!');
      },
      error: (error) => {
        console.error('Error adding driver:', error);
        alert('Failed to add driver. Please try again.');
        this.saving = false;
      }
    });
  }

  loadDrivers(): void {
    this.apiService.getDrivers().subscribe({
      next: (data) => {
        this.drivers = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading drivers:', error);
        this.loading = false;
      }
    });
  }

  getStatusBadge(status: string): string {
    return status === 'active' ? 'badge-success' : 'badge-danger';
  }

  getComplianceBadge(completeness: number): string {
    if (completeness >= 90) return 'badge-success';
    if (completeness >= 75) return 'badge-warning';
    return 'badge-danger';
  }

  isExpiringSoon(dateStr: string): boolean {
    const date = new Date(dateStr);
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    return date <= thirtyDaysFromNow;
  }

  editDriver(driver: any): void {
    this.editingDriver = { ...driver };
    this.showAddForm = false;
    this.showDQFForm = false;
  }

  cancelEdit(): void {
    this.editingDriver = null;
  }

  saveEdit(): void {
    if (!this.validateDriver(this.editingDriver)) {
      alert('Please fill in all required fields');
      return;
    }

    // Check if driver should be set to inactive based on expiry dates and DQF
    const today = new Date();
    const cdlExpiry = this.editingDriver.cdlExpiry ? new Date(this.editingDriver.cdlExpiry) : null;
    const medicalExpiry = this.editingDriver.medicalCertExpiry ? new Date(this.editingDriver.medicalCertExpiry) : null;
    const dqfComplete = this.editingDriver.dqfCompleteness === 100;

    let statusMessage = '';
    if (cdlExpiry && cdlExpiry < today) {
      this.editingDriver.status = 'inactive';
      statusMessage = 'Status set to INACTIVE: CDL expired. ';
    } else if (medicalExpiry && medicalExpiry < today) {
      this.editingDriver.status = 'inactive';
      statusMessage = 'Status set to INACTIVE: Medical certificate expired. ';
    } else if (!dqfComplete) {
      this.editingDriver.status = 'inactive';
      statusMessage = 'Status set to INACTIVE: DQF must be 100% complete. ';
    }

    this.saving = true;
    this.apiService.updateDriver(this.editingDriver.id, this.editingDriver).subscribe({
      next: (updatedDriver) => {
        const index = this.drivers.findIndex(d => d.id === updatedDriver.id);
        if (index !== -1) {
          this.drivers[index] = updatedDriver;
        }
        this.editingDriver = null;
        this.saving = false;
        alert(statusMessage + 'Driver updated successfully!');
      },
      error: (error) => {
        console.error('Error updating driver:', error);
        alert('Failed to update driver. Please try again.');
        this.saving = false;
      }
    });
  }

  validateDriver(driver: any = this.newDriver): boolean {
    return !!(driver.firstName && 
             driver.lastName && 
             driver.email && 
             driver.cdlNumber && 
             driver.cdlState && 
             driver.cdlClass);
  }

  openDQFForm(driver: any): void {
    this.selectedDriver = driver;
    this.showDQFForm = true;
    this.showAddForm = false;
    this.editingDriver = null;
    this.loadDQFStatus(driver);
    this.loadDriverDocuments(driver.id);
  }

  loadDriverDocuments(driverId: string): void {
    this.apiService.getDriverDocuments(driverId).subscribe({
      next: (docs) => {
        this.driverDocuments = docs;
      },
      error: (error) => {
        console.error('Error loading documents:', error);
      }
    });
  }

  getDocumentsByType(documentType: string): any[] {
    return this.driverDocuments.filter(doc => doc.document_type === documentType);
  }

  onDQFFileSelected(event: any, documentType: string): void {
    const file = event.target.files[0];
    if (!file || !this.selectedDriver) return;

    this.uploadingDocuments[documentType] = true;

    this.apiService.uploadDQFDocument(this.selectedDriver.id, documentType, file).subscribe({
      next: (response) => {
        this.driverDocuments.push(response.document);
        this.uploadingDocuments[documentType] = false;
        alert(`${documentType} uploaded successfully!`);
        event.target.value = ''; // Reset file input
      },
      error: (error) => {
        console.error('Error uploading document:', error);
        alert('Failed to upload document. Please try again.');
        this.uploadingDocuments[documentType] = false;
        event.target.value = '';
      }
    });
  }

  deleteDocument(documentId: string, documentType: string): void {
    if (!confirm('Are you sure you want to delete this document?')) return;

    this.apiService.deleteDQFDocument(documentId).subscribe({
      next: () => {
        this.driverDocuments = this.driverDocuments.filter(doc => doc.id !== documentId);
        alert('Document deleted successfully!');
      },
      error: (error) => {
        console.error('Error deleting document:', error);
        alert('Failed to delete document. Please try again.');
      }
    });
  }

  getDownloadUrl(documentId: string): string {
    return this.apiService.downloadDQFDocument(documentId);
  }

  closeDQFForm(): void {
    this.showDQFForm = false;
    this.selectedDriver = null;
  }

  loadDQFStatus(driver: any): void {
    // Calculate DQF completeness based on available data
    const checks = [
      !!driver.email,
      !!driver.cdlNumber,
      !!driver.cdlExpiry && new Date(driver.cdlExpiry) > new Date(),
      !!driver.medicalCertExpiry && new Date(driver.medicalCertExpiry) > new Date(),
      driver.clearinghouseStatus === 'eligible',
      !!driver.hireDate
    ];
    
    this.dqfForm = {
      applicationComplete: !!driver.email && !!driver.phone,
      mvrComplete: !!driver.cdlNumber,
      roadTestComplete: !!driver.hireDate,
      medicalCertComplete: !!driver.medicalCertExpiry && new Date(driver.medicalCertExpiry) > new Date(),
      annualReviewComplete: false,
      clearinghouseConsentComplete: driver.clearinghouseStatus === 'eligible',
      notes: ''
    };
  }

  saveDQFForm(): void {
    // Count how many checkboxes are checked (excluding notes which is a string)
    const checkboxes = [
      this.dqfForm.applicationComplete,
      this.dqfForm.mvrComplete,
      this.dqfForm.roadTestComplete,
      this.dqfForm.medicalCertComplete,
      this.dqfForm.annualReviewComplete,
      this.dqfForm.clearinghouseConsentComplete
    ];
    
    const completedItems = checkboxes.filter(v => v === true).length;
    const totalItems = checkboxes.length;
    const dqfCompleteness = Math.round((completedItems / totalItems) * 100);

    // Set clearinghouse status based on consent checkbox
    const clearinghouseStatus = this.dqfForm.clearinghouseConsentComplete ? 'eligible' : 'query-pending';

    // Check if driver should be set to inactive based on DQF and expiry dates
    const today = new Date();
    const cdlExpiry = this.selectedDriver.cdlExpiry ? new Date(this.selectedDriver.cdlExpiry) : null;
    const medicalExpiry = this.selectedDriver.medicalCertExpiry ? new Date(this.selectedDriver.medicalCertExpiry) : null;
    
    let status = this.selectedDriver.status;
    let statusMessage = '';
    
    if (dqfCompleteness !== 100) {
      status = 'inactive';
      statusMessage = 'Status set to INACTIVE: DQF must be 100% complete. ';
    } else if (cdlExpiry && cdlExpiry < today) {
      status = 'inactive';
      statusMessage = 'Status set to INACTIVE: CDL expired. ';
    } else if (medicalExpiry && medicalExpiry < today) {
      status = 'inactive';
      statusMessage = 'Status set to INACTIVE: Medical certificate expired. ';
    } else if (dqfCompleteness === 100 && (!cdlExpiry || cdlExpiry >= today) && (!medicalExpiry || medicalExpiry >= today)) {
      status = 'active';
      statusMessage = 'Status set to ACTIVE: All requirements met. ';
    }

    this.saving = true;
    this.apiService.updateDriver(this.selectedDriver.id, { 
      dqfCompleteness: dqfCompleteness,
      clearinghouseStatus: clearinghouseStatus,
      status: status
    }).subscribe({
      next: (updatedDriver) => {
        const index = this.drivers.findIndex(d => d.id === updatedDriver.id);
        if (index !== -1) {
          this.drivers[index] = updatedDriver;
        }
        this.closeDQFForm();
        this.saving = false;
        alert(`${statusMessage}DQF updated! Completeness: ${dqfCompleteness}% (${completedItems}/${totalItems} items complete)\nClearinghouse Status: ${clearinghouseStatus}`);
      },
      error: (error) => {
        console.error('Error updating DQF:', error);
        alert('Failed to update DQF. Please try again.');
        this.saving = false;
      }
    });
  }

  onFileSelected(event: any, driver: any): void {
    const file = event.target.files[0];
    if (!file) return;

    // For now, we'll just simulate upload
    // In production, you'd upload to a file server or cloud storage
    this.uploadingFile = true;
    
    setTimeout(() => {
      // Update clearinghouse status to 'consented'
      this.apiService.updateDriver(driver.id, { clearinghouse_status: 'consented' }).subscribe({
        next: (updatedDriver) => {
          const index = this.drivers.findIndex(d => d.id === updatedDriver.id);
          if (index !== -1) {
            this.drivers[index] = updatedDriver;
          }
          this.uploadingFile = false;
          alert(`Clearinghouse consent uploaded for ${driver.firstName} ${driver.lastName}`);
        },
        error: (error) => {
          console.error('Error uploading file:', error);
          alert('Failed to upload file. Please try again.');
          this.uploadingFile = false;
        }
      });
    }, 1000);
  }
}
