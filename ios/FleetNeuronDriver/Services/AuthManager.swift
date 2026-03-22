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
    private let biometricUnlockEnabledKey = "FleetNeuronDriver.biometricUnlockEnabled"
    private let biometricUnlockDeclinedKey = "FleetNeuronDriver.biometricUnlockDeclined"

    @Published var token: String?
    @Published var role: String?
    @Published var driverId: String?
    @Published var username: String?
    @Published var isLoading = false
    @Published var errorMessage: String?

    /// JWT exists in Keychain and user opted in; waiting for Face ID / Touch ID before exposing the token.
    @Published var sessionAwaitingBiometricUnlock = false
    @Published var pendingBiometricOptInPrompt = false
    @Published var biometricUnlockError: String?
    @Published var isBiometricUnlockBusy = false

    var isLoggedIn: Bool { token != nil && !(token?.isEmpty ?? true) }

    private init() {
        migrateJWTFromUserDefaultsIfNeeded()
        role = UserDefaults.standard.string(forKey: roleKey)
        driverId = UserDefaults.standard.string(forKey: driverIdKey)
        username = UserDefaults.standard.string(forKey: usernameKey)

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
                _ = KeychainHelper.saveJWT(res.token)
                UserDefaults.standard.removeObject(forKey: self.legacyTokenUserDefaultsKey)
                UserDefaults.standard.set(res.role, forKey: self.roleKey)
                UserDefaults.standard.set(res.username, forKey: self.usernameKey)
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

    func logout() {
        token = nil
        role = nil
        driverId = nil
        username = nil
        sessionAwaitingBiometricUnlock = false
        pendingBiometricOptInPrompt = false
        biometricUnlockError = nil
        KeychainHelper.deleteJWT()
        UserDefaults.standard.removeObject(forKey: legacyTokenUserDefaultsKey)
        UserDefaults.standard.removeObject(forKey: roleKey)
        UserDefaults.standard.removeObject(forKey: driverIdKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.removeObject(forKey: biometricUnlockEnabledKey)
        UserDefaults.standard.removeObject(forKey: biometricUnlockDeclinedKey)
    }

    func clearError() { errorMessage = nil }
}
