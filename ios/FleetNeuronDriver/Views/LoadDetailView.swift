//
//  LoadDetailView.swift
//  FleetNeuron Driver – load detail + documents (iPhone & iPad)
//

import SwiftUI

@available(iOS 16.0, *)
struct LoadDetailView: View {
    let loadId: String
    var onDismiss: () -> Void
    @EnvironmentObject var auth: AuthManager
    @State private var load: LoadDetail?
    @State private var attachments: [LoadAttachment] = []
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var showUpload = false

    var body: some View {
        Group {
            if loading && load == nil {
                ProgressView("Loading…")
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = errorMessage {
                VStack(spacing: 12) {
                    Text(err)
                        .foregroundStyle(AppTheme.danger)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await fetch() } }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.successGreen)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let load = load {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header(load)
                        stopsSection(load)
                        documentsSection
                    }
                    .padding()
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showUpload = true
                        } label: {
                            Label("Upload document", systemImage: "plus.circle.fill")
                        }
                        .foregroundStyle(AppTheme.brandCyan)
                    }
                }
            }
        }
        .navigationTitle(load?.load_number ?? "Load")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
        .sheet(isPresented: $showUpload) {
            DocumentUploadView(loadId: loadId) {
                showUpload = false
                Task { await fetchAttachments() }
            }
        }
    }

    @ViewBuilder
    private func header(_ load: LoadDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge(load.status ?? "—")
                if let r = load.rate, r > 0 {
                    Text("$\(r, specifier: "%.2f")")
                        .font(.headline)
                        .foregroundStyle(AppTheme.brandCyan)
                }
            }
            if let p = load.pickup_location, !p.isEmpty {
                Label(p, systemImage: "arrow.down.circle")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
            }
            if let d = load.delivery_location, !d.isEmpty {
                Label(d, systemImage: "arrow.down.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
            }
            if let n = load.notes, !n.isEmpty {
                Text(n)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private func statusBadge(_ s: String) -> some View {
        Text(s.replacingOccurrences(of: "_", with: " "))
            .font(.caption.bold())
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

    @ViewBuilder
    private func stopsSection(_ load: LoadDetail) -> some View {
        if let stops = load.stops, !stops.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Stops")
                    .font(.headline)
                    .foregroundStyle(AppTheme.textAccent)
                ForEach(stops) { s in
                    HStack(alignment: .top) {
                        Text(s.stop_type ?? "—")
                            .font(.caption)
                            .frame(width: 60, alignment: .leading)
                            .foregroundStyle(AppTheme.textSecondary)
                        VStack(alignment: .leading, spacing: 2) {
                            if let c = s.city, let st = s.state {
                                Text("\(c), \(st)")
                                    .foregroundStyle(AppTheme.textPrimary)
                            }
                            if let d = s.stop_date {
                                Text(d)
                                    .font(.caption2)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }
                    .padding(8)
                    .background(AppTheme.cardBackground)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(AppTheme.borderColor, lineWidth: 1)
                    )
                }
            }
        }
    }

    private var documentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Documents")
                    .font(.headline)
                    .foregroundStyle(AppTheme.textAccent)
                Spacer()
                Button {
                    showUpload = true
                } label: {
                    Label("Add", systemImage: "plus.circle")
                        .font(.subheadline)
                }
                .foregroundStyle(AppTheme.brandCyan)
            }
            if attachments.isEmpty {
                VStack(spacing: 12) {
                    Text("No documents yet. Upload POD, BOL, lumper receipt, or roadside receipt.")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button {
                        showUpload = true
                    } label: {
                        Label("Upload document", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.successGreen)
                }
                .padding(.vertical, 8)
            } else {
                ForEach(attachments) { att in
                    HStack {
                        Image(systemName: docIcon(att.type))
                            .foregroundStyle(AppTheme.brandCyan)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(att.file_name ?? "—")
                                .lineLimit(1)
                                .foregroundStyle(AppTheme.textPrimary)
                            Text(att.type ?? "—")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        Spacer()
                        if let urlStr = att.file_url, let url = URL(string: urlStr) {
                            Link(destination: url) {
                                Image(systemName: "arrow.down.circle")
                                    .foregroundStyle(AppTheme.brandCyan)
                            }
                        }
                    }
                    .padding(8)
                    .background(AppTheme.cardBackground)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(AppTheme.borderColor, lineWidth: 1)
                    )
                }
            }
        }
    }

    private func docIcon(_ type: String?) -> String {
        switch (type ?? "").uppercased() {
        case "PROOF_OF_DELIVERY", "POD": return "checkmark.circle.fill"
        case "BOL": return "doc.fill"
        case "LUMPER": return "receipt"
        case "ROADSIDE_MAINTENANCE_RECEIPT": return "wrench.fill"
        default: return "doc"
        }
    }

    private func fetch() async {
        await MainActor.run { loading = true; errorMessage = nil }
        defer { Task { @MainActor in loading = false } }
        guard let token = auth.token else { return }
        do {
            let res = try await APIClient.shared.loadDetail(id: loadId, token: token)
            await MainActor.run { load = res.data }
            await fetchAttachments()
        } catch {
            await MainActor.run { errorMessage = error.localizedDescription }
        }
    }

    private func fetchAttachments() async {
        guard let token = auth.token else { return }
        do {
            let res = try await APIClient.shared.loadAttachments(loadId: loadId, token: token)
            await MainActor.run { attachments = res.data ?? [] }
        } catch {
            // non-fatal
        }
    }
}
