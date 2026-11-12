import Foundation
import Security
import LocalAuthentication

struct PasswordEntry: Codable {
    let id: String
    let user: String
    let password: String
    let urls: [String]

    func matches(host: String) -> Bool {
        urls.contains { value in
            guard let url = URLComponents(string: value), url.scheme == "https", url.user == nil, url.password == nil else { return false }
            return url.host?.lowercased() == host.lowercased()
        }
    }
}

struct PasswordCache: Codable {
    let createdAt: TimeInterval
    let passwords: [PasswordEntry]

    func validate(now: TimeInterval = Date().timeIntervalSince1970) throws {
        guard createdAt <= now + 60, now - createdAt <= 86400 else { throw VaultError.expired }
    }
}

struct StoredPasskey: Codable {
    let id: Data
    let rp: String
    let userName: String
    let userHandle: Data
    let encryptedKey: String
}

enum VaultError: Error {
    case unavailable
    case expired
    case invalid
}

final class CredentialVault {
    let directory: URL
    let scope: String

    init() throws {
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.melonigemelone.app") else { throw VaultError.unavailable }
        let scope = try String(contentsOf: directory.appendingPathComponent("active.txt"), encoding: .utf8)
        guard scope.count == 64, scope.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { throw VaultError.invalid }
        self.directory = directory
        self.scope = scope
    }

    init(directory: URL, scope: String) {
        self.directory = directory
        self.scope = scope
    }

    func withKey<T>(_ action: (Data) throws -> T) throws -> T {
        let context = LAContext()
        defer { context.invalidate() }
        context.localizedReason = "MelonApp AutoFill entsperren"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "de.melonapp.autofill.v1",
            kSecAttrAccount as String: scope,
            kSecAttrAccessGroup as String: "group.de.melonigemelone.app",
            kSecAttrSynchronizable as String: false,
            kSecUseDataProtectionKeychain as String: true,
            kSecUseAuthenticationContext as String: context,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, var key = result as? Data, key.count == 32 else { throw VaultError.unavailable }
        defer { key.resetBytes(in: key.startIndex..<key.endIndex) }
        return try action(key)
    }

    private func read(_ name: String, scope aad: String, key: Data, limit: Int) throws -> Data {
        let url = directory.appendingPathComponent(name)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular, let size = attributes[.size] as? NSNumber, size.intValue <= limit else { throw VaultError.invalid }
        return try decryptCache(key: key, ciphertext: String(contentsOf: url, encoding: .utf8), scope: aad)
    }

    func read(_ kind: String, key: Data) throws -> Data {
        try read("\(scope).\(kind).enc", scope: "autofill/v1/\(scope)/\(kind)", key: key, limit: 48 * 1024 * 1024)
    }

    func passwords() throws -> [PasswordEntry] {
        try withKey { key in
            var plaintext = try read("passwords", key: key)
            defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
            let cache = try JSONDecoder().decode(PasswordCache.self, from: plaintext)
            try cache.validate()
            return cache.passwords
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ name: String, scope aad: String, key: Data, limit: Int) -> T? {
        guard FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path),
              var plaintext = try? read(name, scope: aad, key: key, limit: limit) else { return nil }
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        return try? JSONDecoder().decode(type, from: plaintext)
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    func passkeys(key: Data) -> [StoredPasskey] {
        var result: [StoredPasskey] = []
        let prefix = "\(scope).outbox."
        let names = ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).sorted()
        for name in names where name.hasPrefix(prefix) && name.hasSuffix(".enc") {
            let id = String(name.dropFirst(prefix.count).dropLast(4))
            guard id.count == 64, let passkey = decode(StoredPasskey.self, name, scope: "autofill/v1/\(scope)/outbox/\(id)", key: key, limit: 64 * 1024),
                  Self.hex(passkey.id) == id else { continue }
            result.append(passkey)
        }
        result += decode([StoredPasskey].self, "\(scope).passkeys.enc", scope: "autofill/v1/\(scope)/passkeys", key: key, limit: 8 * 1024 * 1024) ?? []
        result += decode([StoredPasskey].self, "\(scope).synced.enc", scope: "autofill/v1/\(scope)/synced", key: key, limit: 48 * 1024 * 1024) ?? []
        var seen = Set<Data>()
        return result.filter { seen.insert($0.id).inserted }
    }

    func saveOutbox(_ passkey: StoredPasskey, key: Data) throws {
        let id = Self.hex(passkey.id)
        guard passkey.id.count == 32 else { throw VaultError.invalid }
        var plaintext = try JSONEncoder().encode(passkey)
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        let ciphertext = try encryptCache(key: key, plaintext: plaintext, scope: "autofill/v1/\(scope)/outbox/\(id)")
        try Data(ciphertext.utf8).write(to: directory.appendingPathComponent("\(scope).outbox.\(id).enc"), options: [.atomic, .completeFileProtection])
    }
}
