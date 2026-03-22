//
//  WebAppURLs.swift
//  FleetNeuron Driver — FleetNeuron web UI base (forgot password, etc.)
//

import Foundation

enum WebAppURLs {
    /// Public web app origin (no trailing slash). Matches Angular routes under the main FleetNeuron UI.
    static var base: String {
        let raw =
            (Bundle.main.object(forInfoDictionaryKey: "WEB_BASE_URL") as? String)
                ?? ProcessInfo.processInfo.environment["WEB_BASE_URL"]
                ?? "https://fleetneuron.ai"
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `GET` path used by the Angular app for password reset request form.
    static let forgotPasswordPath = "/forgot-password"

    static func forgotPasswordURL() -> URL? {
        var b = base
        while b.hasSuffix("/") { b.removeLast() }
        return URL(string: b + forgotPasswordPath)
    }
}
