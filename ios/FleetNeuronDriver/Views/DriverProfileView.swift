//
//  DriverProfileView.swift
//  FleetNeuron Driver — FN-164: profile (name, MC, contact, sign out)
//

import SwiftUI

@available(iOS 16.0, *)
struct DriverProfileView: View {
    @EnvironmentObject var auth: AuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var loading = true
    @State private var loadError: String?
    @State private var driver: DriverDetailPayload?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerSection

                if loading {
                    ProgressView()
                        .tint(AppTheme.successGreen)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                }
                if let loadError {
                    Text(loadError)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.danger)
                        .padding(.vertical, 8)
                }

                sectionTitle("Carrier")
                profileRow(label: "MC number", value: mcDisplay)
                multiEntityFootnote

                sectionTitle("Contact")
                profileRow(label: "Email", value: emailDisplay)
                profileRow(label: "Phone", value: phoneDisplay)

                Button {
                    auth.logout()
                    dismiss()
                } label: {
                    HStack {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                        Text("Sign out")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .foregroundStyle(.white)
                    .background(AppTheme.danger.opacity(0.9))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.top, 16)
                .accessibilityLabel("Sign out and return to login")
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("My Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Close") { dismiss() }
                    .foregroundStyle(AppTheme.successGreen)
            }
        }
        .task { await loadProfile() }
    }

    private var headerSection: some View {
        HStack(spacing: 16) {
            Circle()
                .fill(AppTheme.successGreen.opacity(0.3))
                .frame(width: 72, height: 72)
                .overlay(
                    Image(systemName: "person.fill")
                        .font(.title)
                        .foregroundStyle(AppTheme.successGreen)
                )
            VStack(alignment: .leading, spacing: 4) {
                Text(displayName)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                if let oe = driver?.operatingEntityName, !oe.isEmpty {
                    Text(oe)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    Text("FleetNeuron Driver")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.successGreen)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 8)
    }

    private var displayName: String {
        if let d = driver {
            let parts = [d.firstName, d.lastName].compactMap { $0 }.filter { !$0.isEmpty }
            if !parts.isEmpty { return parts.joined(separator: " ") }
        }
        let fromLogin = [auth.profileFirstName, auth.profileLastName].compactMap { $0 }.filter { !$0.isEmpty }
        if !fromLogin.isEmpty { return fromLogin.joined(separator: " ") }
        return auth.username ?? "Driver"
    }

    private var mcDisplay: String {
        if let m = driver?.mcNumber, !m.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return m
        }
        return "—"
    }

    private var emailDisplay: String {
        if let e = driver?.email, !e.isEmpty { return e }
        if let e = auth.profileEmail, !e.isEmpty { return e }
        return "—"
    }

    private var phoneDisplay: String {
        if let p = driver?.phone, !p.isEmpty { return p }
        return "—"
    }

    /// FN-166: no in-app MC / operating-entity switch API for drivers yet — clarify single-context behavior.
    private var multiEntityFootnote: some View {
        Text(
            "This app uses the carrier (MC) linked to your driver profile. Switching between multiple carriers in one account is not available in the driver app; use the FleetNeuron web app or contact your administrator if you need a different default."
        )
        .font(.caption2)
        .foregroundStyle(AppTheme.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 4)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(AppTheme.textSecondary)
    }

    private func profileRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.body)
                .foregroundStyle(AppTheme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(AppTheme.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(AppTheme.borderColor, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func loadProfile() async {
        guard let token = auth.token else {
            await MainActor.run {
                loading = false
                loadError = "Not signed in."
            }
            return
        }
        await MainActor.run {
            loading = true
            loadError = nil
        }
        do {
            let meRes = try await APIClient.shared.me(token: token)
            if let profile = meRes.data {
                await MainActor.run { auth.applyMeProfile(profile) }
            }
            let did = await MainActor.run { auth.effectiveDriverId }
            var d: DriverDetailPayload?
            if let did {
                d = try await APIClient.shared.driverDetail(id: did, token: token)
            }
            await MainActor.run {
                driver = d
                loading = false
                loadError = nil
            }
        } catch {
            await MainActor.run {
                loading = false
                driver = nil
                loadError = error.localizedDescription
            }
        }
    }
}
