//
//  JWTClaims.swift
//  FleetNeuron Driver — read non-sensitive claims from JWT payload (no signature verify)
//

import Foundation

enum JWTClaims {
    /// Returns `driver_id` from JWT payload when present (same claim the API signs at login).
    static func driverId(from jwt: String) -> String? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var segment = String(parts[1])
        let remainder = segment.count % 4
        if remainder > 0 { segment += String(repeating: "=", count: 4 - remainder) }
        let base64 = segment
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        guard let data = Data(base64Encoded: base64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if let s = obj["driver_id"] as? String, !s.isEmpty { return s }
        return nil
    }
}
