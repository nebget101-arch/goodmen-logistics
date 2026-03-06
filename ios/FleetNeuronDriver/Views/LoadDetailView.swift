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
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = errorMessage {
                VStack(spacing: 12) {
                    Text(err)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await fetch() } }
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
                }
            }
            if let p = load.pickup_location, !p.isEmpty {
                Label(p, systemImage: "arrow.down.circle")
                    .font(.subheadline)
            }
            if let d = load.delivery_location, !d.isEmpty {
                Label(d, systemImage: "arrow.down.circle.fill")
                    .font(.subheadline)
            }
            if let n = load.notes, !n.isEmpty {
                Text(n)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func statusBadge(_ s: String) -> some View {
        Text(s.replacingOccurrences(of: "_", with: " "))
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.blue.opacity(0.2))
            .clipShape(Capsule())
    }

    @ViewBuilder
    private func stopsSection(_ load: LoadDetail) -> some View {
        if let stops = load.stops, !stops.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Stops")
                    .font(.headline)
                ForEach(stops) { s in
                    HStack(alignment: .top) {
                        Text(s.stop_type ?? "—")
                            .font(.caption)
                            .frame(width: 60, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            if let c = s.city, let st = s.state {
                                Text("\(c), \(st)")
                            }
                            if let d = s.stop_date {
                                Text(d)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    private var documentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Documents")
                    .font(.headline)
                Spacer()
                Button {
                    showUpload = true
                } label: {
                    Label("Add", systemImage: "plus.circle")
                        .font(.subheadline)
                }
            }
            if attachments.isEmpty {
                VStack(spacing: 12) {
                    Text("No documents yet. Upload POD, BOL, lumper receipt, or roadside receipt.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button {
                        showUpload = true
                    } label: {
                        Label("Upload document", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.vertical, 8)
            } else {
                ForEach(attachments) { att in
                    HStack {
                        Image(systemName: docIcon(att.type))
                            .foregroundStyle(.blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(att.file_name ?? "—")
                                .lineLimit(1)
                            Text(att.type ?? "—")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let urlStr = att.file_url, let url = URL(string: urlStr) {
                            Link(destination: url) {
                                Image(systemName: "arrow.down.circle")
                            }
                        }
                    }
                    .padding(8)
                    .background(Color.gray.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
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
