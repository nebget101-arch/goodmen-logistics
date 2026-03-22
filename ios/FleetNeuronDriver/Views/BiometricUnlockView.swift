//
//  BiometricUnlockView.swift
//  FleetNeuron Driver
//

import SwiftUI

@available(iOS 16.0, *)
struct BiometricUnlockView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            RadialGradient(
                colors: [
                    Color(red: 45/255, green: 212/255, blue: 191/255).opacity(0.12),
                    Color.clear
                ],
                center: .topLeading,
                startRadius: 0,
                endRadius: 400
            )
            .ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer(minLength: 24)
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [AppTheme.textAccent, AppTheme.successGreen],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Text("Unlock FleetNeuron")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text("Use \(BiometricAuth.biometricTypeDescription()) to continue.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                if let err = auth.biometricUnlockError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Button(action: { Task { await auth.unlockSessionWithBiometrics() } }) {
                    HStack {
                        if auth.isBiometricUnlockBusy {
                            ProgressView()
                                .tint(AppTheme.textAccent)
                        }
                        Image(systemName: BiometricAuth.biometricSystemImageName())
                        Text("Unlock with \(BiometricAuth.biometricTypeDescription())")
                    }
                    .font(.headline)
                    .foregroundStyle(AppTheme.textAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(AppTheme.primaryButtonGradient)
                    .clipShape(Capsule())
                }
                .disabled(auth.isBiometricUnlockBusy)
                .padding(.horizontal, 24)

                Button("Use password instead") {
                    auth.logout()
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppTheme.accentTeal)

                Spacer()
            }
        }
        .task {
            await auth.unlockSessionWithBiometrics()
        }
    }
}
