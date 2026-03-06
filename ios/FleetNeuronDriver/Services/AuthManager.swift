//
//  AuthManager.swift
//  FleetNeuron Driver
//

import Foundation
import Combine
import SwiftUI

final class AuthManager: ObservableObject {
    static let shared = AuthManager()

    private let tokenKey = "FleetNeuronDriver.token"
    private let roleKey = "FleetNeuronDriver.role"
    private let driverIdKey = "FleetNeuronDriver.driverId"
    private let usernameKey = "FleetNeuronDriver.username"

    @Published var token: String?
    @Published var role: String?
    @Published var driverId: String?
    @Published var username: String?
    @Published var isLoading = false
    @Published var errorMessage: String?

    var isLoggedIn: Bool { token != nil && !(token?.isEmpty ?? true) }

    private init() {
        token = UserDefaults.standard.string(forKey: tokenKey)
        role = UserDefaults.standard.string(forKey: roleKey)
        driverId = UserDefaults.standard.string(forKey: driverIdKey)
        username = UserDefaults.standard.string(forKey: usernameKey)
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
                UserDefaults.standard.set(res.token, forKey: self.tokenKey)
                UserDefaults.standard.set(res.role, forKey: self.roleKey)
                UserDefaults.standard.set(res.username, forKey: self.usernameKey)
                if let d = did { UserDefaults.standard.set(d, forKey: driverIdKey) }
                else { UserDefaults.standard.removeObject(forKey: driverIdKey) }
            }
        } catch {
            await MainActor.run { errorMessage = error.localizedDescription }
        }
    }

    func logout() {
        token = nil
        role = nil
        driverId = nil
        username = nil
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: roleKey)
        UserDefaults.standard.removeObject(forKey: driverIdKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
    }

    func clearError() { errorMessage = nil }
}
