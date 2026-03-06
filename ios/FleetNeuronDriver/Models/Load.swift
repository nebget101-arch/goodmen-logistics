//
//  Load.swift
//  FleetNeuron Driver
//

import Foundation

/// Decodes id from either String (UUID) or Int from backend.
struct FlexibleId: Codable {
    let value: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let i = try? c.decode(Int.self) { value = String(i) }
        else { throw DecodingError.typeMismatch(FlexibleId.self, .init(codingPath: decoder.codingPath, debugDescription: "id must be String or Int")) }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}

/// Backend may send rate as string (e.g. "3600.00") or number.
struct FlexibleDouble: Codable {
    let value: Double?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self), let d = Double(s) { value = d }
        else if c.decodeNil() { value = nil }
        else { value = nil }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}

/// Backend may send attachment_count as string (e.g. "1") or number.
struct FlexibleInt: Codable {
    let value: Int?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) { value = i }
        else if let s = try? c.decode(String.self), let i = Int(s) { value = i }
        else if c.decodeNil() { value = nil }
        else { value = nil }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}

struct LoadsListResponse: Codable {
    let success: Bool
    let data: [LoadListItem]?
    let meta: LoadListMeta?
}

struct LoadListMeta: Codable {
    let page: Int?
    let pageSize: Int?
    let total: Int?
}

struct LoadListItem: Codable, Identifiable {
    private let _id: FlexibleId?
    var id: String { _id?.value ?? "" }
    let load_number: String?
    let status: String?
    let billing_status: String?
    private let _rate: FlexibleDouble?
    var rate: Double? { _rate?.value }
    let completed_date: String?
    let pickup_date: String?
    let delivery_date: String?
    let pickup_city: String?
    let pickup_state: String?
    let delivery_city: String?
    let delivery_state: String?
    let driver_name: String?
    let broker_name: String?
    let po_number: String?
    private let _attachment_count: FlexibleInt?
    var attachment_count: Int? { _attachment_count?.value }
    let attachment_types: [String]?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case _id = "id"
        case _rate = "rate"
        case _attachment_count = "attachment_count"
        case load_number, status, billing_status, completed_date, pickup_date, delivery_date
        case pickup_city, pickup_state, delivery_city, delivery_state, driver_name, broker_name
        case po_number, attachment_types, notes
    }
}

struct LoadDetailResponse: Codable {
    let success: Bool
    let data: LoadDetail?
}

struct LoadDetail: Codable, Identifiable {
    private let _id: FlexibleId?
    var id: String { _id?.value ?? "" }
    let load_number: String?
    let status: String?
    let billing_status: String?
    private let _rate: FlexibleDouble?
    var rate: Double? { _rate?.value }
    let pickup_location: String?
    let delivery_location: String?
    let pickup_date: String?
    let delivery_date: String?
    let driver_name: String?
    let broker_name: String?
    let po_number: String?
    let notes: String?
    let stops: [LoadStop]?
    let attachments: [LoadAttachment]?

    enum CodingKeys: String, CodingKey {
        case _id = "id"
        case _rate = "rate"
        case load_number, status, billing_status, pickup_location, delivery_location
        case pickup_date, delivery_date, driver_name, broker_name, po_number, notes, stops, attachments
    }
}

struct LoadStop: Codable, Identifiable {
    let stop_type: String?
    let stop_date: String?
    let city: String?
    let state: String?
    let zip: String?
    let address1: String?
    let address2: String?
    private let _sequence: FlexibleInt?
    var sequence: Int? { _sequence?.value }
    private let _stopId: FlexibleId?
    var id: String { _stopId?.value ?? "\(stop_type ?? "")-\(sequence ?? 0)" }

    enum CodingKeys: String, CodingKey {
        case stop_type, stop_date, city, state, zip, address1, address2
        case _sequence = "sequence"
        case _stopId = "id"
    }
}

struct LoadAttachment: Codable, Identifiable {
    private let _id: FlexibleId?
    var id: String { _id?.value ?? "" }
    let load_id: String?
    let type: String?
    let file_name: String?
    let file_url: String?
    let mime_type: String?
    private let _size_bytes: FlexibleInt?
    var size_bytes: Int? { _size_bytes?.value }
    let notes: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case _id = "id"
        case load_id, type, file_name, file_url, mime_type
        case _size_bytes = "size_bytes"
        case notes, created_at
    }
}
