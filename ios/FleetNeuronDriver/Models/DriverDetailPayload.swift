//
//  DriverDetailPayload.swift
//  FleetNeuron Driver — GET /api/drivers/:id (camelCase from backend transformRow)
//

import Foundation

/// Subset of driver JSON used on the profile screen.
struct DriverDetailPayload: Codable {
    let id: String?
    let firstName: String?
    let lastName: String?
    let email: String?
    let phone: String?
    let mcNumber: String?
    let operatingEntityName: String?
}
