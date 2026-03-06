//
//  AuthResponse.swift
//  FleetNeuron Driver
//

import Foundation

struct AuthResponse: Codable {
    let token: String
    let role: String?
    let username: String?
    let firstName: String?
    let lastName: String?
    let email: String?
}

struct UserResponse: Codable {
    let success: Bool
    let data: UserProfile?
}

struct UserProfile: Codable {
    let id: String?
    let username: String?
    let first_name: String?
    let last_name: String?
    let email: String?
    let role: String?
    let driver_id: String?
}
