//
//  ContentView.swift
//  FleetNeuron Driver – root: Login or My Loads (iPhone & iPad)
//

import SwiftUI

// MARK: - AppTheme (AI-centric design, matches web)
enum AppTheme {
    static let background = Color(hex: "020617")
    static let cardBackground = Color(red: 15/255, green: 23/255, blue: 42/255).opacity(0.96)
    static let textPrimary = Color(hex: "e5e7eb")
    static let textSecondary = Color(hex: "9ca3af")
    static let textAccent = Color(hex: "e5f9ff")
    static let brandCyan = Color(hex: "a5f3fc")
    static let successGreen = Color(hex: "22c55e")
    static let accentBlue = Color(hex: "3b82f6")
    static let accentTeal = Color(hex: "2dd4bf")
    static let borderColor = Color.white.opacity(0.12)
    static let danger = Color(hex: "ef4444")
    static let warning = Color(hex: "f59e0b")

    static var primaryButtonGradient: LinearGradient {
        LinearGradient(
            colors: [successGreen, accentBlue],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    static var pillBackgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 45/255, green: 212/255, blue: 191/255).opacity(0.3),
                cardBackground
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

@available(iOS 16.0, *)
struct ContentView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            RadialGradient(
                colors: [
                    Color(red: 45/255, green: 212/255, blue: 191/255).opacity(0.08),
                    Color.clear
                ],
                center: .topLeading,
                startRadius: 0,
                endRadius: 350
            )
            .ignoresSafeArea()
            RadialGradient(
                colors: [
                    Color(red: 59/255, green: 130/255, blue: 246/255).opacity(0.1),
                    Color.clear
                ],
                center: .bottomTrailing,
                startRadius: 0,
                endRadius: 350
            )
            .ignoresSafeArea()

            Group {
                if auth.isLoggedIn {
                    MainDriverView()
                } else {
                    LoginView()
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: auth.isLoggedIn)
    }
}
