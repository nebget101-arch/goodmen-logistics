import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RoadsideService } from '../../services/roadside.service';

@Component({
  selector: 'app-public-roadside',
  templateUrl: './public-roadside.component.html',
  styleUrls: ['./public-roadside.component.css']
})
export class PublicRoadsideComponent implements OnInit {
  loading = true;
  saving = false;
  savingContext = false;
  errorMessage = '';
  successMessage = '';
  locationStatus = 'Location not shared yet.';

  callId = '';
  token = '';
  call: any = null;

  contextForm: any = {
    company_name: '',
    payment_contact_name: '',
    payment_email: '',
    payment_phone: '',
    unit_number: '',
    caller_name: '',
    caller_email: '',
    caller_phone: '',
    summary: '',
    dispatch_location_label: '',
    location: null
  };

  get previewLocation(): { latitude: number; longitude: number } | null {
    const formLoc = this.contextForm?.location;
    const snapshotLoc = this.call?.location_snapshot?.shared_location;
    const source = formLoc || snapshotLoc;
    if (!source) return null;
    const latitude = Number(source.latitude);
    const longitude = Number(source.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  get mapEmbedUrl(): string {
    const p = this.previewLocation;
    if (!p) return '';
    const delta = 0.01;
    const left = p.longitude - delta;
    const right = p.longitude + delta;
    const top = p.latitude + delta;
    const bottom = p.latitude - delta;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${p.latitude}%2C${p.longitude}`;
  }

  get mapOpenUrl(): string {
    const p = this.previewLocation;
    if (!p) return '';
    return `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=14/${p.latitude}/${p.longitude}`;
  }

  constructor(private route: ActivatedRoute, private roadsideService: RoadsideService) {}

  ngOnInit(): void {
    this.callId = this.route.snapshot.paramMap.get('callId') || '';
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    this.load();
  }

  load(): void {
    if (!this.callId || !this.token) {
      this.loading = false;
      this.errorMessage = 'Missing callId or token.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.roadsideService.getPublicCall(this.callId, this.token).subscribe({
      next: (row) => {
        this.call = row;
        this.contextForm = {
          ...this.contextForm,
          company_name: row?.location_snapshot?.company_name || '',
          payment_contact_name: row?.location_snapshot?.payment_contact_name || '',
          payment_email: row?.location_snapshot?.payment_email || '',
          payment_phone: row?.location_snapshot?.payment_phone || '',
          unit_number: row?.location_snapshot?.unit_number || '',
          caller_name: row?.caller_name || '',
          caller_email: row?.caller_email || '',
          caller_phone: row?.caller_phone || '',
          summary: row?.incident_summary || '',
          dispatch_location_label: row?.location_snapshot?.dispatch_location_label || ''
        };

        if (row?.location_snapshot?.shared_location?.latitude && row?.location_snapshot?.shared_location?.longitude) {
          this.locationStatus = `Location on file: ${Number(row.location_snapshot.shared_location.latitude).toFixed(5)}, ${Number(row.location_snapshot.shared_location.longitude).toFixed(5)}`;
        }
        this.loading = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'This link is invalid or expired.';
        this.loading = false;
      }
    });
  }

  async onUploadMedia(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !this.callId || !this.token) return;

    this.saving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const signed: any = await firstValueFrom(this.roadsideService.createPublicMediaUploadUrl(this.callId, this.token, {
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        media_type: file.type.startsWith('image/') ? 'PHOTO' : 'DOCUMENT'
      }));

      await this.roadsideService.uploadFileToSignedUrl(signed.upload_url, file);

      await firstValueFrom(this.roadsideService.attachMedia(this.callId, this.token, {
        storage_key: signed.storage_key,
        media_type: signed.media_type || 'PHOTO',
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        metadata: { file_name: file.name }
      }));

      this.successMessage = 'Media uploaded successfully.';
    } catch (error: any) {
      this.errorMessage = error?.message || 'Upload failed.';
    } finally {
      this.saving = false;
      input.value = '';
    }
  }

  requestLocation(): void {
    if (!navigator.geolocation) {
      this.locationStatus = 'Geolocation is not supported in this browser.';
      return;
    }

    this.locationStatus = 'Requesting location permission...';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.contextForm.location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_meters: position.coords.accuracy,
          captured_at: new Date().toISOString(),
          source: 'BROWSER_GEOLOCATION'
        };
        this.locationStatus = `Location captured: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)} (±${Math.round(position.coords.accuracy)}m)`;
      },
      (error) => {
        this.locationStatus = `Location not available (${error.message}).`;
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  saveContext(): void {
    if (!this.callId || !this.token) return;

    this.savingContext = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.roadsideService.updatePublicContext(this.callId, this.token, this.contextForm).subscribe({
      next: (row) => {
        this.call = { ...this.call, ...row };
        this.successMessage = 'Contact, payment, unit and dispatch location details saved.';
        this.savingContext = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to save details.';
        this.savingContext = false;
      }
    });
  }

  complete(): void {
    if (!this.callId || !this.token) return;

    this.roadsideService.completePublicFlow(this.callId, this.token).subscribe({
      next: () => {
        this.successMessage = 'Submission completed. Thank you.';
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Unable to complete this link.';
      }
    });
  }
}
