//
//  ContentView.swift
//  FleetNeuron Driver – root: Login or My Loads (iPhone & iPad)
//

import SwiftUI

@available(iOS 16.0, *)
struct ContentView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        Group {
            if auth.isLoggedIn {
                LoadListView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: auth.isLoggedIn)
    }
}
