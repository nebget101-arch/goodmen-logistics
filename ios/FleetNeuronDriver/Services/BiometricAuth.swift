//
//  BiometricAuth.swift
//  FleetNeuron Driver
//

import Foundation
import LocalAuthentication

enum BiometricAuth {
    /// True when Face ID / Touch ID can be used (device enrolled; may be false on Simulator).
    static func isBiometricLoginAvailable() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    static func biometricTypeDescription() -> String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "Biometrics"
        }
    }

    static func biometricSystemImageName() -> String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.shield.fill"
        }
    }

    /// Prompts for Face ID / Touch ID only (no device passcode fallback), per product scope.
    static func authenticateForUnlock() async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Use Password"
        let reason = "Unlock FleetNeuron Driver to access your loads."
        do {
            return try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            )
        } catch {
            return false
        }
    }
}
