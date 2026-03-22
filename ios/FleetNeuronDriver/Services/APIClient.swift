//
//  APIClient.swift
//  FleetNeuron Driver
//

import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case noData
    case decoding(Error)
    case server(String)
    /// Authenticated request returned 401; session was cleared. Single path — no retry loops.
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid API URL"
        case .noData: return "No data received"
        case .decoding(let e):
            return "Server response format is invalid. \(e.localizedDescription) Check that API_BASE_URL points to your backend (e.g. http://localhost:4000) and that the backend is running."
        case .server(let msg): return msg
        case .sessionExpired: return "Your session expired. Please sign in again."
        }
    }
}

/// Base URL for the FleetNeuron API gateway (no trailing slash).
/// Set in scheme or use default for simulator pointing to host machine.
var apiBaseURL: String {
    (Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String)
        ?? ProcessInfo.processInfo.environment["API_BASE_URL"]
        ?? "http://localhost:4000"
}

final class APIClient {
    static let shared = APIClient()

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 30
        return URLSession(configuration: c)
    }()

    private init() {}

    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        token: String?,
        retryingAfterRefresh: Bool = false
    ) async throws -> T {
        guard let url = URL(string: apiBaseURL + path) else { throw APIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = body {
            req.httpBody = body
        }

        let (data, res) = try await session.data(for: req)
        guard let http = res as? HTTPURLResponse else { throw APIError.noData }

        if http.statusCode == 401 {
            if let token = token {
                if !retryingAfterRefresh, let newToken = await Self.refreshAccessTokenIfAvailable(currentAccessToken: token) {
                    await MainActor.run { AuthManager.shared.applyRefreshedAccessToken(newToken) }
                    return try await self.request(path, method: method, body: body, token: newToken, retryingAfterRefresh: true)
                }
                await MainActor.run { AuthManager.shared.handleSessionExpiredFromAPI() }
                throw APIError.sessionExpired
            }
            let msg = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
            throw APIError.server(msg ?? "Invalid username or password.")
        }

        if http.statusCode >= 400 {
            let msg = (try? JSONDecoder().decode(ServerError.self, from: data))?.error ?? "Request failed (\(http.statusCode))"
            throw APIError.server(msg)
        }
        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch let decodingError as DecodingError {
            throw APIError.decoding(decodingError)
        }
    }

    func upload(
        path: String,
        fileData: Data,
        fileName: String,
        mimeType: String,
        type: String,
        notes: String?,
        token: String?,
        retryingAfterRefresh: Bool = false
    ) async throws -> LoadAttachmentResponse {
        guard let url = URL(string: apiBaseURL + path) else { throw APIError.invalidURL }
        let boundary = UUID().uuidString
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token = token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"type\"\r\n\r\n\(type)\r\n".data(using: .utf8)!)
        if let n = notes, !n.isEmpty {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"notes\"\r\n\r\n\(n)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        let (data, res) = try await session.data(for: req)
        guard let http = res as? HTTPURLResponse else { throw APIError.noData }

        if http.statusCode == 401 {
            if let token = token {
                if !retryingAfterRefresh, let newToken = await Self.refreshAccessTokenIfAvailable(currentAccessToken: token) {
                    await MainActor.run { AuthManager.shared.applyRefreshedAccessToken(newToken) }
                    return try await self.upload(
                        path: path,
                        fileData: fileData,
                        fileName: fileName,
                        mimeType: mimeType,
                        type: type,
                        notes: notes,
                        token: newToken,
                        retryingAfterRefresh: true
                    )
                }
                await MainActor.run { AuthManager.shared.handleSessionExpiredFromAPI() }
                throw APIError.sessionExpired
            }
            let msg = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
            throw APIError.server(msg ?? "Invalid username or password.")
        }

        if http.statusCode >= 400 {
            let msg = (try? JSONDecoder().decode(ServerError.self, from: data))?.error ?? "Upload failed (\(http.statusCode))"
            throw APIError.server(msg)
        }
        return try JSONDecoder().decode(LoadAttachmentResponse.self, from: data)
    }

    /// When backend documents `POST /api/auth/refresh` (or similar), implement and return a new JWT. Returns `nil` until then (no extra 404 traffic).
    private static func refreshAccessTokenIfAvailable(currentAccessToken _: String) async -> String? {
        nil
    }

    // MARK: - Auth
    func login(username: String, password: String) async throws -> AuthResponse {
        let body = ["username": username, "password": password]
        let data = try JSONEncoder().encode(body)
        return try await request("/api/auth/login", method: "POST", body: data, token: nil)
    }

    func me(token: String) async throws -> UserResponse {
        return try await request("/api/users/me", token: token)
    }

    // MARK: - Loads
    func loadList(token: String, driverId: String?) async throws -> LoadsListResponse {
        var path = "/api/loads?pageSize=100"
        if let d = driverId, !d.isEmpty { path += "&driverId=\(d.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? d)" }
        return try await request(path, token: token)
    }

    func loadDetail(id: String, token: String) async throws -> LoadDetailResponse {
        return try await request("/api/loads/\(id)", token: token)
    }

    func loadAttachments(loadId: String, token: String) async throws -> LoadAttachmentsResponse {
        return try await request("/api/loads/\(loadId)/attachments", token: token)
    }

    func uploadAttachment(loadId: String, fileData: Data, fileName: String, mimeType: String, type: String, notes: String?, token: String) async throws -> LoadAttachmentResponse {
        return try await upload(path: "/api/loads/\(loadId)/attachments", fileData: fileData, fileName: fileName, mimeType: mimeType, type: type, notes: notes, token: token)
    }
}

private struct ServerError: Codable { let error: String? }
struct LoadAttachmentResponse: Codable { let success: Bool?; let data: LoadAttachment? }
struct LoadAttachmentsResponse: Codable { let success: Bool?; let data: [LoadAttachment]? }
