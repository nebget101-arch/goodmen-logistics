//
//  FleetNeuronDriverApp.swift
//  FleetNeuron Driver – My Loads & Documents (iPhone & iPad)
//

import SwiftUI

@main
@available(iOS 16.0, *)
struct FleetNeuronDriverApp: App {
    @StateObject private var auth = AuthManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .preferredColorScheme(.dark)
        }
    }
}
