//
//  LoginView.swift
//  FleetNeuron Driver – AI-style dark login
//

import SwiftUI

@available(iOS 16.0, *)
struct LoginView: View {
    @EnvironmentObject var auth: AuthManager
    @State private var username = ""
    @State private var password = ""
    @State private var forgotSafariItem: ForgotSafariSheetItem?

    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()
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
            RadialGradient(
                colors: [
                    Color(red: 59/255, green: 130/255, blue: 246/255).opacity(0.14),
                    Color.clear
                ],
                center: .bottomTrailing,
                startRadius: 0,
                endRadius: 400
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {
                    Spacer(minLength: 20)
                    brandBlock
                    loginPanel
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
            }
        }
        .onTapGesture { hideKeyboard() }
        .sheet(item: $forgotSafariItem) { item in
            SafariWebView(url: item.url)
        }
    }

    private var brandBlock: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .stroke(AppTheme.accentTeal.opacity(0.4), lineWidth: 1)
                    .frame(width: 100, height: 100)
                Circle()
                    .stroke(AppTheme.accentBlue.opacity(0.5), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "truck.box.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [AppTheme.textAccent, AppTheme.successGreen],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
            VStack(spacing: 4) {
                Text("FleetNeuron")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color(hex: "e0f2fe"),
                                Color(hex: "a5f3fc"),
                                Color(hex: "67e8f9")
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                Text("DRIVER")
                    .font(.caption2.weight(.semibold))
                    .tracking(2)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(.bottom, 8)
    }

    private var loginPanel: some View {
        VStack(spacing: 20) {
            HStack {
                Text("Sign in")
                    .font(.headline)
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text("DRIVER")
                    .font(.caption2.weight(.semibold))
                    .tracking(1)
                    .padding(4)
                    .padding(.horizontal, 8)
                    .background(AppTheme.pillBackgroundGradient)
                    .foregroundStyle(AppTheme.brandCyan)
                    .clipShape(Capsule())
            }
            .padding(.bottom, 4)

            VStack(alignment: .leading, spacing: 6) {
                Text("Username")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                TextField("Username", text: $username)
                    .textContentType(.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .modifier(ThemedTextFieldModifier())
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Password")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .modifier(ThemedTextFieldModifier())
            }

            if let err = auth.errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(AppTheme.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }

            Button(action: signIn) {
                HStack {
                    if auth.isLoading {
                        ProgressView()
                            .tint(AppTheme.textAccent)
                    }
                    Text(auth.isLoading ? "Signing in…" : "Sign In")
                }
                .modifier(PrimaryButtonModifier())
            }
            .disabled(auth.isLoading || username.isEmpty || password.isEmpty)
            .opacity(auth.isLoading || username.isEmpty || password.isEmpty ? 0.7 : 1)
        }
        .padding(24)
        .background(AppTheme.cardBackground)
        .cornerRadius(20)
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(AppTheme.borderColor, lineWidth: 1)
        )
    }

    private func signIn() {
        auth.clearError()
        Task { await auth.login(username: username, password: password) }
    }

    private func openForgotPasswordInSafari() {
        guard let url = WebAppURLs.forgotPasswordURL() else { return }
        forgotSafariItem = ForgotSafariSheetItem(url: url)
    }
}

private struct ForgotSafariSheetItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct ThemedTextFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(12)
            .background(AppTheme.cardBackground)
            .foregroundStyle(AppTheme.textPrimary)
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(AppTheme.borderColor, lineWidth: 1)
            )
    }
}

@available(iOS 16.0, *)
private struct PrimaryButtonModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.headline)
            .foregroundStyle(AppTheme.textAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(AppTheme.primaryButtonGradient)
            .clipShape(Capsule())
    }
}

private func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
