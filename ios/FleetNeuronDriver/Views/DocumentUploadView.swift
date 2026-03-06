//
//  DocumentUploadView.swift
//  FleetNeuron Driver – upload POD, BOL, lumper, roadside receipt (iPhone & iPad)
//

import SwiftUI
import UniformTypeIdentifiers
import PhotosUI

@available(iOS 16.0, *)
struct DocumentUploadView: View {
    let loadId: String
    var onComplete: () -> Void
    @EnvironmentObject var auth: AuthManager
    @Environment(\.dismiss) private var dismiss
    @State private var selectedType: AttachmentType = .proofOfDelivery
    @State private var notes = ""
    @State private var selectedItem: PhotosPickerItem?
    @State private var selectedData: Data?
    @State private var uploading = false
    @State private var errorMessage: String?

    enum AttachmentType: String, CaseIterable, Identifiable {
        case proofOfDelivery = "PROOF_OF_DELIVERY"
        case bol = "BOL"
        case lumper = "LUMPER"
        case roadsideReceipt = "ROADSIDE_MAINTENANCE_RECEIPT"
        case other = "OTHER"
        var id: String { rawValue }
        var label: String {
            switch self {
            case .proofOfDelivery: return "Proof of Delivery"
            case .bol: return "BOL (Bill of Lading)"
            case .lumper: return "Lumper Receipt"
            case .roadsideReceipt: return "Roadside Maintenance Receipt"
            case .other: return "Other"
            }
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Document type") {
                    Picker("Type", selection: $selectedType) {
                        ForEach(AttachmentType.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    .pickerStyle(.menu)
                }
                Section("File") {
                    PhotosPicker(
                        selection: $selectedItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        if selectedData != nil {
                            Label("Photo selected", systemImage: "checkmark.circle.fill")
                        } else {
                            Label("Choose photo", systemImage: "photo.on.rectangle.angled")
                        }
                    }
                    // Use the older iOS 16-style onChange signature (single value parameter)
                    .onChange(of: selectedItem) { newValue in
                        Task {
                            if let data = try? await newValue?.loadTransferable(type: Data.self) {
                                await MainActor.run { selectedData = data }
                            }
                        }
                    }
                    if selectedData != nil {
                        Button("Clear selection") {
                            selectedItem = nil
                            selectedData = nil
                        }
                    }
                }
                Section("Notes (optional)") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
                if let err = errorMessage {
                    Section {
                        Text(err)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Upload document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Upload") { Task { await upload() } }
                        .disabled(uploading || selectedData == nil)
                }
            }
            .overlay {
                if uploading {
                    ProgressView("Uploading…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.ultraThinMaterial)
                }
            }
        }
    }

    private func upload() async {
        guard let token = auth.token, let data = selectedData else { return }
        await MainActor.run { uploading = true; errorMessage = nil }
        defer { Task { @MainActor in uploading = false } }
        let fileName = "\(selectedType.rawValue)_\(Date().timeIntervalSince1970).jpg"
        do {
            _ = try await APIClient.shared.uploadAttachment(
                loadId: loadId,
                fileData: data,
                fileName: fileName,
                mimeType: "image/jpeg",
                type: selectedType.rawValue,
                notes: notes.isEmpty ? nil : notes,
                token: token
            )
            await MainActor.run {
                onComplete()
                dismiss()
            }
        } catch {
            await MainActor.run { errorMessage = error.localizedDescription }
        }
    }
}
