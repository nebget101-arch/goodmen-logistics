import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { OnboardingModalService } from './services/onboarding-modal.service';
import { ApiService } from './services/api.service';
import { AiChatService, AiChatMessage, AiSuggestion } from './services/ai-chat.service';
import { AccessControlService } from './services/access-control.service';
import { OperatingEntityContextService } from './services/operating-entity-context.service';
import { NAV_TOP_LINKS, NAV_SECTIONS, NavSection, NavLink } from './config/nav.config';
import { PERMISSIONS } from './models/access-control.model';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styles: [`
    .app {
      min-height: 100vh;
    }
    .dqf-close-btn {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 18px;
    }
  `]
})
export class AppComponent implements OnInit {
  title = 'FleetNeuron AI';
  sidebarOpen = false;
  userMenuOpen = false;
  aiChatOpen = false;
  aiConversationId: string | null = null;
  aiMessages: AiChatMessage[] = [];
  aiSuggestions: AiSuggestion[] = [];
  aiInput = '';
  aiSending = false;

  readonly navTopLinks = NAV_TOP_LINKS;
  readonly navSections = NAV_SECTIONS;
  readonly adminMenuPermissions = [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_ADMIN, PERMISSIONS.USERS_EDIT];
  private readonly authTransitionStorageKey = 'fleetneuron_auth_transitioning';
  /** Section expand state aligned to current nav section count (default collapsed). */
  sectionExpanded: boolean[] = this.navSections.map(() => false);

  constructor(
    private router: Router,
    public onboardingModal: OnboardingModalService,
    private apiService: ApiService,
    private aiChatService: AiChatService,
    public access: AccessControlService,
    public operatingEntityContext: OperatingEntityContextService
  ) {}

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  isAuthTransitioning(): boolean {
    return sessionStorage.getItem(this.authTransitionStorageKey) === '1';
  }

  shouldRenderProtectedShell(): boolean {
    return this.isLoggedIn() && !this.isShelllessRoute() && !this.isAuthTransitioning();
  }

  getCurrentRoute(): string {
    return this.router.url || '';
  }

  /** Returns true when on a route that should not render the main app shell. */
  isShelllessRoute(): boolean {
    const url = this.router.url || '';
    return (
      url.startsWith('/home') ||
      url.startsWith('/login') ||
      url.startsWith('/onboard/') ||
      (url.startsWith('/roadside/') && url !== '/roadside')
    );
  }

  /** Backward-compatible alias used by public page layout bindings. */
  isPublicRoute(): boolean {
    return this.isShelllessRoute();
  }

  toggleAiChat(): void {
    if (!this.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.aiChatOpen = !this.aiChatOpen;
  }

  sendAiMessage(): void {
    const trimmed = (this.aiInput || '').trim();
    if (!trimmed || this.aiSending) return;

    const nowIso = new Date().toISOString();
    const localUserMessage: AiChatMessage = {
      id: `local_user_${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: nowIso
    };

    this.aiMessages = [...this.aiMessages, localUserMessage];
    this.aiInput = '';
    this.aiSending = true;

    const payload = {
      message: trimmed,
      conversationId: this.aiConversationId,
      context: {
        route: this.getCurrentRoute()
      },
      clientMeta: {
        uiSurface: 'global-chat'
      }
    };

    this.aiChatService.sendMessage(payload).subscribe({
      next: (resp) => {
        this.aiConversationId = resp.conversationId;
        this.aiMessages = resp.messages;
        this.aiSuggestions = resp.suggestions || [];
        this.aiSending = false;
      },
      error: () => {
        this.aiSending = false;
        this.aiSuggestions = [];
      }
    });
  }

  handleAiSuggestionClick(sugg: AiSuggestion): void {
    if (!sugg) return;
    if (sugg.type === 'navigation') {
      const target = sugg.payload?.targetScreen || '';
      const params = sugg.payload?.params || {};
      const route =
        target === 'work-order'
          ? ['/work-order']
          : target === 'parts'
          ? ['/parts']
          : target === 'maintenance'
          ? ['/maintenance']
          : ['/dashboard'];
      this.router.navigate(route, { queryParams: params });
      this.aiChatOpen = false;
      return;
    }

    if (sugg.type === 'workOrderDraft') {
      const draft = sugg.payload || {};
      this.router.navigate(['/work-order'], {
        state: {
          aiWorkOrderDraft: draft
        }
      });
      this.aiChatOpen = false;
      return;
    }
  }

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    this.access.clearAccess();
    this.operatingEntityContext.reset();
    this.router.navigate(['/login']);
  }

  onOperatingEntityChange(rawId: string): void {
    const selectedId = (rawId || '').toString().trim();
    if (!selectedId) return;
    this.operatingEntityContext.selectOperatingEntity(selectedId);
  }

  /** Whether a nav section should be visible (uses tab or tabs from config). */
  canSeeSection(section: NavSection): boolean {
    return section.children.some((child) => this.canSeeLink(child));
  }

  /** Whether a section child link should be visible (optional role filter). */
  canSeeLink(link: NavLink): boolean {
    if (link.featureFlag && !this.access.hasFeatureAccess(link.featureFlag)) return false;
    if (!this.access.canSee(link.tab)) return false;
    if (link.roles?.length) return this.access.hasAnyRole(link.roles);
    return this.access.canAccessUrl(link.path);
  }

  canSeeAdminMenuLink(path: string, permissionCodes: string[]): boolean {
    return this.access.hasAnyPermission(permissionCodes) && this.access.canAccessUrl(path);
  }

  canSeeTrialRequestsAdmin(): boolean {
    return this.access.canAccessTrialRequestsAdmin();
  }

  getSectionExpanded(index: number): boolean {
    return this.sectionExpanded[index] ?? true;
  }

  toggleSection(index: number): void {
    if (index >= 0 && index < this.sectionExpanded.length) {
      this.sectionExpanded[index] = !this.sectionExpanded[index];
      this.sectionExpanded = [...this.sectionExpanded];
    }
  }

  ngOnInit(): void {
    if (!this.isLoggedIn()) {
      sessionStorage.removeItem(this.authTransitionStorageKey);
    }
    if (this.isLoggedIn()) {
      this.access.loadAccess().subscribe();
    }
    this.operatingEntityContext.bootstrapFromSessionIfNeeded(this.isLoggedIn());
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
  }

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  closeUserMenu(): void {
    this.userMenuOpen = false;
  }


  onSidebarNavClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Close the sidebar on mobile when a nav link is clicked.
    if (target.closest('a')) {
      this.closeSidebar();
    }
  }

  closeOnboardingModal(): void {
    this.onboardingModal.close();
  }

  sendOnboardingPacket(): void {
    const m = this.onboardingModal;
    if (!m.driver) return;
    if (!m.via) {
      alert('Please select how to send the packet (SMS, Email, or Both).');
      return;
    }
    if ((m.via === 'sms' || m.via === 'both') && !m.phone) {
      alert('Phone number is required for SMS.');
      return;
    }
    if ((m.via === 'email' || m.via === 'both') && !m.email) {
      alert('Email is required for Email.');
      return;
    }

    m.setSending(true);
    const driverId = m.driver.id;

    this.apiService.createOnboardingPacket(driverId).subscribe({
      next: (packetResp: any) => {
        const packetId = packetResp.packetId;
        this.apiService
          .sendOnboardingPacket(packetId, { via: m.via, phone: m.phone, email: m.email })
          .subscribe({
            next: (sendResp: any) => {
              m.setSending(false);
              m.setResultUrl(sendResp.publicUrl || packetResp.publicUrl || null);
              alert('Onboarding packet sent successfully.');
            },
            error: () => {
              alert('Failed to send onboarding packet.');
              m.setSending(false);
            }
          });
      },
      error: () => {
        alert('Failed to create onboarding packet.');
        m.setSending(false);
      }
    });
  }
}
