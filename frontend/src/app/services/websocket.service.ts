import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/**
 * FN-813: Browser Socket.IO client for FleetNeuron real-time updates.
 *
 * The gateway attaches Socket.IO on `/socket.io` and expects the JWT in the
 * handshake `auth.token` field (see `backend/gateway/index.js`). Connection
 * joins `tenant:<tenant_id>` on the server and receives room-scoped load and
 * presence events.
 *
 * Responsibilities:
 * - Connect on login / app init with the JWT from localStorage.
 * - Exponential-backoff reconnect (delegated to socket.io-client's built-in
 *   reconnect manager, which is well tested and handles transport fallback).
 * - Surface events as per-event RxJS Subjects (`on<T>(event)`).
 * - Fall back to 30s polling after `MAX_RECONNECT_ATTEMPTS` failed reconnects:
 *   `pollTick$` emits and subscribers re-run their existing list fetch.
 * - Expose a `status$: Observable<ConnectionStatus>` so the UI can render a
 *   header dot and a "Reconnecting…" banner.
 */
@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {
  private socket: Socket | null = null;
  private manualClose = false;
  private failedReconnectAttempts = 0;
  private pollingTimer: any = null;

  /** After this many consecutive reconnect failures, drop into polling mode. */
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly POLL_INTERVAL_MS = 30_000;

  private readonly _status$ = new BehaviorSubject<ConnectionStatus>('disconnected');
  readonly status$: Observable<ConnectionStatus> = this._status$.asObservable();

  private readonly _pollTick$ = new Subject<void>();
  /** Emits every `POLL_INTERVAL_MS` once the client has fallen back to polling. */
  readonly pollTick$: Observable<void> = this._pollTick$.asObservable();

  /**
   * One `Subject` per server-emitted event name. A single subject is shared by
   * every subscriber so handlers are attached to the Socket only once.
   */
  private readonly eventSubjects = new Map<string, Subject<any>>();
  /** Event names we've already wired a socket listener for. */
  private readonly boundEvents = new Set<string>();

  constructor(private zone: NgZone) {}

  /**
   * Open the socket. Safe to call multiple times — no-op when already
   * connected or connecting. Pulls the JWT from localStorage at call time so
   * callers don't need to re-wire after login.
   */
  connect(): void {
    if (this.socket && (this.socket.connected || (this.socket as any).active)) return;
    const token = this.readToken();
    if (!token) {
      this._status$.next('disconnected');
      return;
    }
    this.manualClose = false;
    this.failedReconnectAttempts = 0;
    const { host, secure } = this.deriveGatewayLocation();
    const url = `${secure ? 'https' : 'http'}://${host}`;

    const socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: { token },
      reconnection: true,
      reconnectionAttempts: this.MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });

    // Re-bind any previously-registered subjects to the new socket instance.
    this.boundEvents.forEach((evt) => this.attachServerEvent(socket, evt));

    // Run socket callbacks outside Angular zone to avoid a change-detection
    // pass on every heartbeat; re-enter for status changes via `zone.run`.
    this.zone.runOutsideAngular(() => {
      socket.on('connect', () => this.zone.run(() => this.onConnect()));
      socket.on('disconnect', (reason: string) => this.zone.run(() => this.onDisconnect(reason)));
      socket.on('connect_error', (_err: any) => this.zone.run(() => this.onConnectError()));
      socket.io.on('reconnect_attempt', () => this.zone.run(() => this._status$.next('reconnecting')));
      socket.io.on('reconnect_failed', () => this.zone.run(() => this.onReconnectFailed()));
    });

    this.socket = socket;
    this._status$.next('reconnecting');
  }

  /** Cleanly close the socket and stop all timers. */
  disconnect(): void {
    this.manualClose = true;
    this.stopPolling();
    if (this.socket) {
      try { this.socket.disconnect(); } catch { /* noop */ }
      this.socket = null;
    }
    this.failedReconnectAttempts = 0;
    this._status$.next('disconnected');
  }

  /**
   * Subscribe to a specific server event. Returns the same Subject on repeat
   * calls so multiple components share emissions without double-binding the
   * underlying Socket listener.
   */
  on<T = any>(event: string): Observable<T> {
    let subj = this.eventSubjects.get(event);
    if (!subj) {
      subj = new Subject<any>();
      this.eventSubjects.set(event, subj);
    }
    if (!this.boundEvents.has(event)) {
      this.boundEvents.add(event);
      if (this.socket) this.attachServerEvent(this.socket, event);
    }
    return subj.asObservable() as Observable<T>;
  }

  /** True when currently connected (connected, not reconnecting / offline). */
  isConnected(): boolean {
    return this._status$.value === 'connected';
  }

  /** Send an event to the server. Silent no-op when not connected. */
  send(event: string, payload?: any): boolean {
    if (!this.socket || !this.socket.connected) return false;
    try {
      this.socket.emit(event, payload);
      return true;
    } catch {
      return false;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
    this._status$.complete();
    this._pollTick$.complete();
    this.eventSubjects.forEach((s) => s.complete());
    this.eventSubjects.clear();
    this.boundEvents.clear();
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private onConnect(): void {
    this.failedReconnectAttempts = 0;
    this.stopPolling();
    this._status$.next('connected');
  }

  private onDisconnect(reason: string): void {
    // 'io client disconnect' means disconnect() was called explicitly.
    if (this.manualClose || reason === 'io client disconnect') {
      this._status$.next('disconnected');
      return;
    }
    this._status$.next('reconnecting');
  }

  private onConnectError(): void {
    this.failedReconnectAttempts++;
    if (this.failedReconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.startPolling();
      this._status$.next('disconnected');
    } else {
      this._status$.next('reconnecting');
    }
  }

  private onReconnectFailed(): void {
    // socket.io-client hit its reconnectionAttempts cap — enter polling mode.
    this.startPolling();
    this._status$.next('disconnected');
  }

  private attachServerEvent(socket: Socket, event: string): void {
    socket.on(event, (payload: any) => {
      // Re-enter Angular zone so views update when an event causes a state
      // change. Events can arrive while we're outside NgZone because of
      // `runOutsideAngular` in `connect()`.
      this.zone.run(() => {
        const subj = this.eventSubjects.get(event);
        if (subj) subj.next(payload);
      });
    });
  }

  private startPolling(): void {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(() => this._pollTick$.next(), this.POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
  }

  private readToken(): string | null {
    try {
      return localStorage.getItem('token');
    } catch {
      return null;
    }
  }

  /**
   * Derive the gateway host + scheme from `environment.apiUrl` (which ends in
   * `/api`). Socket.IO negotiates its own transport on the derived origin; we
   * pass the path separately via the `path` option.
   */
  private deriveGatewayLocation(): { host: string; secure: boolean } {
    const apiUrl = environment.apiUrl || '';
    try {
      const u = new URL(apiUrl);
      return { host: u.host, secure: u.protocol === 'https:' };
    } catch {
      const fallback = typeof window !== 'undefined' ? window.location : null;
      return {
        host: fallback?.host || 'localhost:3333',
        secure: fallback?.protocol === 'https:',
      };
    }
  }
}

/** Canonical server event names broadcast by the FleetNeuron gateway. */
export const WS_EVENTS = {
  LOAD_CREATED: 'load:created',
  LOAD_UPDATED: 'load:updated',
  LOAD_DELETED: 'load:deleted',
  LOAD_STATUS_CHANGED: 'load:status_changed',
  PRESENCE_JOIN: 'presence:join',
  PRESENCE_LEAVE: 'presence:leave',
} as const;
