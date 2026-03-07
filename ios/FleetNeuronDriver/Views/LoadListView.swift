//
//  LoadListView.swift
//  FleetNeuron Driver – My Loads list (iPhone & iPad adaptive)
//

import SwiftUI

@available(iOS 16.0, *)
struct LoadListView: View {
    @EnvironmentObject var auth: AuthManager
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var loads: [LoadListItem] = []
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var selectedLoadId: String?
    @State private var refreshing = false

    private var isCompact: Bool { sizeClass == .compact }

    var body: some View {
        Group {
            if isCompact {
                NavigationStack {
                    listContentCompact
                }
            } else {
                NavigationSplitView {
                    listContent
                } detail: {
                    if let id = selectedLoadId {
                        LoadDetailView(loadId: id, onDismiss: { selectedLoadId = nil })
                    } else {
                        Text("Select a load")
                            .foregroundStyle(AppTheme.textSecondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Log Out") {
                    auth.logout()
                }
                .foregroundStyle(AppTheme.brandCyan)
            }
        }
        .navigationTitle("My Loads")
        .navigationBarTitleDisplayMode(isCompact ? .inline : .large)
        .task { await fetchLoads() }
        .refreshable { await fetchLoads() }
    }

    /// iPhone: list with explicit NavigationLink so tap always pushes to detail.
    @ViewBuilder
    private var listContentCompact: some View {
        Group {
            if loading && loads.isEmpty {
                ProgressView("Loading loads…")
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = errorMessage {
                VStack(spacing: 12) {
                    Text(err)
                        .foregroundStyle(AppTheme.danger)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await fetchLoads() } }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.successGreen)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loads.isEmpty {
                Text("No loads assigned")
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(loads) { load in
                    NavigationLink {
                        LoadDetailView(loadId: load.id, onDismiss: {})
                    } label: {
                        LoadRowView(load: load)
                    }
                    .listRowBackground(AppTheme.cardBackground)
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
        }
    }

    @ViewBuilder
    private var listContent: some View {
        Group {
            if loading && loads.isEmpty {
                ProgressView("Loading loads…")
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = errorMessage {
                VStack(spacing: 12) {
                    Text(err)
                        .foregroundStyle(AppTheme.danger)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await fetchLoads() } }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.successGreen)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loads.isEmpty {
                Text("No loads assigned")
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(loads, selection: $selectedLoadId) { load in
                    NavigationLink(value: load.id) {
                        LoadRowView(load: load)
                    }
                    .tag(load.id)
                    .listRowBackground(AppTheme.cardBackground)
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
        }
        .onAppear {
            if !isCompact, selectedLoadId == nil, let first = loads.first {
                selectedLoadId = first.id
            }
        }
    }

    private func fetchLoads() async {
        guard let token = auth.token else { return }
        await MainActor.run { loading = true; errorMessage = nil }
        defer { Task { @MainActor in loading = false } }
        do {
            let res = try await APIClient.shared.loadList(token: token, driverId: auth.driverId)
            let allLoads = res.data ?? []
            // Exclude delivered – show only assigned (new/in-progress) loads
            let active = allLoads.filter { ($0.status ?? "").uppercased() != "DELIVERED" }
            await MainActor.run {
                loads = active
                if !isCompact, selectedLoadId == nil, let first = loads.first {
                    selectedLoadId = first.id
                }
            }
        } catch {
            await MainActor.run { errorMessage = error.localizedDescription }
        }
    }
}

struct LoadRowView: View {
    let load: LoadListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(load.load_number ?? "—")
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
            HStack(spacing: 8) {
                statusBadge(load.status ?? "—")
                if let r = load.rate, r > 0 {
                    Text("$\(r, specifier: "%.2f")")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.brandCyan)
                }
            }
            if let pick = load.pickup_city, let st = load.pickup_state, !pick.isEmpty {
                Text("\(pick), \(st) → \(load.delivery_city ?? ""), \(load.delivery_state ?? "")")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 6)
    }

    private func statusBadge(_ s: String) -> some View {
        Text(s.replacingOccurrences(of: "_", with: " "))
            .font(.caption2.weight(.semibold))
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                LinearGradient(
                    colors: [
                        AppTheme.successGreen.opacity(0.25),
                        AppTheme.accentBlue.opacity(0.15)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .foregroundStyle(AppTheme.brandCyan)
            .clipShape(Capsule())
    }
}
