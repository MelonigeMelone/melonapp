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
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.melonapp.shared") else { throw VaultError.unavailable }
        let scope = try String(contentsOf: directory.appendingPathComponent("active.txt"), encoding: .utf8)
        guard scope.count == 64, scope.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { throw VaultError.invalid }
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
            kSecAttrAccessGroup as String: "group.de.melonapp.shared",
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

    func read(_ kind: String, key: Data) throws -> Data {
        let url = directory.appendingPathComponent("\(scope).\(kind).enc")
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 48 * 1024 * 1024 else { throw VaultError.invalid }
        return try decryptCache(key: key, ciphertext: String(contentsOf: url, encoding: .utf8), scope: "autofill/v1/\(scope)/\(kind)")
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

    func passkeys(key: Data) throws -> [StoredPasskey] {
        guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("\(scope).passkeys.enc").path) else { return [] }
        var plaintext = try read("passkeys", key: key)
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        return try JSONDecoder().decode([StoredPasskey].self, from: plaintext)
    }

    func save(_ passkeys: [StoredPasskey], key: Data) throws {
        var plaintext = try JSONEncoder().encode(passkeys)
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        let ciphertext = try encryptCache(key: key, plaintext: plaintext, scope: "autofill/v1/\(scope)/passkeys")
        try Data(ciphertext.utf8).write(to: directory.appendingPathComponent("\(scope).passkeys.enc"), options: [.atomic, .completeFileProtection])
    }
}
