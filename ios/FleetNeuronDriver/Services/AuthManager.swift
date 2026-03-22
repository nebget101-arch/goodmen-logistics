//
//  AuthManager.swift
//  FleetNeuron Driver
//

import Foundation
import Combine
import SwiftUI

final class AuthManager: ObservableObject {
    static let shared = AuthManager()

    /// Legacy UserDefaults key; JWT must not remain here after migration (FN-161).
    private let legacyTokenUserDefaultsKey = "FleetNeuronDriver.token"
    private let roleKey = "FleetNeuronDriver.role"
    private let driverIdKey = "FleetNeuronDriver.driverId"
    private let usernameKey = "FleetNeuronDriver.username"
    private let firstNameKey = "FleetNeuronDriver.firstName"
    private let lastNameKey = "FleetNeuronDriver.lastName"
    private let emailKey = "FleetNeuronDriver.email"
    private let biometricUnlockEnabledKey = "FleetNeuronDriver.biometricUnlockEnabled"
    private let biometricUnlockDeclinedKey = "FleetNeuronDriver.biometricUnlockDeclined"

    @Published var token: String?
    @Published var role: String?
    @Published var driverId: String?
    @Published var username: String?
    /// From login response; used when `/users/me` has no name fields.
    @Published var profileFirstName: String?
    @Published var profileLastName: String?
    @Published var profileEmail: String?
    @Published var isLoading = false
    @Published var errorMessage: String?

    /// JWT exists in Keychain and user opted in; waiting for Face ID / Touch ID before exposing the token.
    @Published var sessionAwaitingBiometricUnlock = false
    @Published var pendingBiometricOptInPrompt = false
    @Published var biometricUnlockError: String?
    @Published var isBiometricUnlockBusy = false

    var isLoggedIn: Bool { token != nil && !(token?.isEmpty ?? true) }

    /// Prefer stored `driverId`; otherwise read `driver_id` from JWT (e.g. before first `/me` refresh).
    var effectiveDriverId: String? {
        if let id = driverId, !id.isEmpty { return id }
        guard let t = token, !t.isEmpty else { return nil }
        return JWTClaims.driverId(from: t)
    }

    private init() {
        migrateJWTFromUserDefaultsIfNeeded()
        role = UserDefaults.standard.string(forKey: roleKey)
        driverId = UserDefaults.standard.string(forKey: driverIdKey)
        username = UserDefaults.standard.string(forKey: usernameKey)
        profileFirstName = UserDefaults.standard.string(forKey: firstNameKey)
        profileLastName = UserDefaults.standard.string(forKey: lastNameKey)
        profileEmail = UserDefaults.standard.string(forKey: emailKey)

        let jwt = KeychainHelper.readJWT()
        let wantsBiometricGate = UserDefaults.standard.bool(forKey: biometricUnlockEnabledKey)

        if wantsBiometricGate, jwt != nil, BiometricAuth.isBiometricLoginAvailable() {
            sessionAwaitingBiometricUnlock = true
            token = nil
        } else {
            token = jwt
            sessionAwaitingBiometricUnlock = false
        }
    }

    /// One-time migration: copy JWT from UserDefaults into Keychain and remove from defaults.
    private func migrateJWTFromUserDefaultsIfNeeded() {
        if KeychainHelper.readJWT() != nil {
            UserDefaults.standard.removeObject(forKey: legacyTokenUserDefaultsKey)
            return
        }
        guard let legacy = UserDefaults.standard.string(forKey: legacyTokenUserDefaultsKey),
              !legacy.isEmpty
        else { return }
        _ = KeychainHelper.saveJWT(legacy)
        UserDefaults.standard.removeObject(forKey: legacyTokenUserDefaultsKey)
    }

    func login(username: String, password: String) async {
        await MainActor.run { isLoading = true; errorMessage = nil }
        defer { Task { @MainActor in isLoading = false } }
        do {
            let res = try await APIClient.shared.login(username: username, password: password)
            var did: String?
            if (res.role ?? "").lowercased() == "driver" {
                let meRes = try await APIClient.shared.me(token: res.token)
                did = meRes.data?.driver_id
            }
            await MainActor.run {
                self.token = res.token
                self.role = res.role
                self.username = res.username
                self.driverId = did
                self.profileFirstName = res.firstName
                self.profileLastName = res.lastName
                self.profileEmail = res.email
                _ = KeychainHelper.saveJWT(res.token)
                UserDefaults.standard.removeObject(forKey: self.legacyTokenUserDefaultsKey)
                UserDefaults.standard.set(res.role, forKey: self.roleKey)
                UserDefaults.standard.set(res.username, forKey: self.usernameKey)
                Self.persistOptionalString(res.firstName, key: self.firstNameKey)
                Self.persistOptionalString(res.lastName, key: self.lastNameKey)
                Self.persistOptionalString(res.email, key: self.emailKey)
                if let d = did { UserDefaults.standard.set(d, forKey: driverIdKey) }
                else { UserDefaults.standard.removeObject(forKey: driverIdKey) }
                self.sessionAwaitingBiometricUnlock = false
                self.evaluatePostLoginBiometricPrompt()
            }
        } catch {
            await MainActor.run { errorMessage = error.localizedDescription }
        }
    }

    private func evaluatePostLoginBiometricPrompt() {
        guard BiometricAuth.isBiometricLoginAvailable() else { return }
        guard !UserDefaults.standard.bool(forKey: biometricUnlockEnabledKey) else { return }
        guard !UserDefaults.standard.bool(forKey: biometricUnlockDeclinedKey) else { return }
        pendingBiometricOptInPrompt = true
    }

    func completeBiometricOptIn(accept: Bool) {
        guard pendingBiometricOptInPrompt else { return }
        pendingBiometricOptInPrompt = false
        if accept {
            UserDefaults.standard.set(true, forKey: biometricUnlockEnabledKey)
            UserDefaults.standard.removeObject(forKey: biometricUnlockDeclinedKey)
        } else {
            UserDefaults.standard.set(true, forKey: biometricUnlockDeclinedKey)
        }
    }

    func unlockSessionWithBiometrics() async {
        await MainActor.run {
            isBiometricUnlockBusy = true
            biometricUnlockError = nil
        }
        defer { Task { @MainActor in isBiometricUnlockBusy = false } }
        let ok = await BiometricAuth.authenticateForUnlock()
        await MainActor.run {
            if ok {
                self.token = KeychainHelper.readJWT()
                self.sessionAwaitingBiometricUnlock = false
                self.biometricUnlockError = nil
            } else {
                self.biometricUnlockError = "Biometric authentication did not succeed. Try again or use your password."
            }
        }
    }

    /// Called after a successful token refresh (FN-163); keeps session metadata, updates JWT + Keychain.
    func applyRefreshedAccessToken(_ newToken: String) {
        token = newToken
        _ = KeychainHelper.saveJWT(newToken)
    }

    /// 401 on an authenticated API call: clear session and surface a login message (no infinite retries).
    func handleSessionExpiredFromAPI() {
        logout()
        errorMessage = "Your session expired. Please sign in again."
    }

    func logout() {
        token = nil
        role = nil
        driverId = nil
        username = nil
        profileFirstName = nil
        profileLastName = nil
        profileEmail = nil
        sessionAwaitingBiometricUnlock = false
        pendingBiometricOptInPrompt = false
        biometricUnlockError = nil
        KeychainHelper.deleteJWT()
        UserDefaults.standard.removeObject(forKey: legacyTokenUserDefaultsKey)
        UserDefaults.standard.removeObject(forKey: roleKey)
        UserDefaults.standard.removeObject(forKey: driverIdKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.removeObject(forKey: firstNameKey)
        UserDefaults.standard.removeObject(forKey: lastNameKey)
        UserDefaults.standard.removeObject(forKey: emailKey)
        UserDefaults.standard.removeObject(forKey: biometricUnlockEnabledKey)
        UserDefaults.standard.removeObject(forKey: biometricUnlockDeclinedKey)
    }

    func clearError() { errorMessage = nil }

    /// Apply `/api/users/me` result (driver_id from JWT-backed session).
    func applyMeProfile(_ p: UserProfile) {
        driverId = p.driver_id
        if let d = p.driver_id, !d.isEmpty { UserDefaults.standard.set(d, forKey: driverIdKey) }
        else { UserDefaults.standard.removeObject(forKey: driverIdKey) }
        if let f = p.first_name, !f.isEmpty { profileFirstName = f; UserDefaults.standard.set(f, forKey: firstNameKey) }
        if let l = p.last_name, !l.isEmpty { profileLastName = l; UserDefaults.standard.set(l, forKey: lastNameKey) }
        if let e = p.email, !e.isEmpty { profileEmail = e; UserDefaults.standard.set(e, forKey: emailKey) }
    }

    private static func persistOptionalString(_ value: String?, key: String) {
        if let v = value, !v.isEmpty { UserDefaults.standard.set(v, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
    }
}
