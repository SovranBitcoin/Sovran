import Foundation
import CryptoKit
import Security

enum BitchatProfileScope {
    static func storageSuffix(for profileScope: String) -> String {
        let trimmed = profileScope.trimmingCharacters(in: .whitespacesAndNewlines)
        let source = trimmed.isEmpty ? "default" : trimmed
        let digest = SHA256.hash(data: Data(source.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

final class ProfileScopedBitchatKeychain: KeychainManagerProtocol {
    private let base = KeychainManager()
    private let suffix: String

    init(profileScope: String) {
        self.suffix = BitchatProfileScope.storageSuffix(for: profileScope)
    }

    private func scopedKey(_ key: String) -> String {
        "sovran_\(suffix)_\(key)"
    }

    private func scopedService(_ service: String) -> String {
        "\(service).sovran.\(suffix)"
    }

    func saveIdentityKey(_ keyData: Data, forKey key: String) -> Bool {
        base.saveIdentityKey(keyData, forKey: scopedKey(key))
    }

    func getIdentityKey(forKey key: String) -> Data? {
        base.getIdentityKey(forKey: scopedKey(key))
    }

    func deleteIdentityKey(forKey key: String) -> Bool {
        base.deleteIdentityKey(forKey: scopedKey(key))
    }

    func deleteAllKeychainData() -> Bool {
        let serviceSuffix = ".sovran.\(suffix)"
        let accountPrefix = "identity_sovran_\(suffix)_"
        let searchQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(searchQuery as CFDictionary, &result)
        guard status == errSecSuccess, let items = result as? [[String: Any]] else {
            return status == errSecItemNotFound
        }

        var ok = true
        for item in items {
            let account = item[kSecAttrAccount as String] as? String ?? ""
            let service = item[kSecAttrService as String] as? String ?? ""
            guard account.hasPrefix(accountPrefix) || service.hasSuffix(serviceSuffix) else {
                continue
            }
            var deleteQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword]
            if !account.isEmpty { deleteQuery[kSecAttrAccount as String] = account }
            if !service.isEmpty { deleteQuery[kSecAttrService as String] = service }
            let deleteStatus = SecItemDelete(deleteQuery as CFDictionary)
            ok = ok && (deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound)
        }
        return ok
    }

    func secureClear(_ data: inout Data) {
        base.secureClear(&data)
    }

    func secureClear(_ string: inout String) {
        base.secureClear(&string)
    }

    func verifyIdentityKeyExists() -> Bool {
        getIdentityKey(forKey: "noiseStaticKey") != nil
    }

    func getIdentityKeyWithResult(forKey key: String) -> KeychainReadResult {
        base.getIdentityKeyWithResult(forKey: scopedKey(key))
    }

    func saveIdentityKeyWithResult(_ keyData: Data, forKey key: String) -> KeychainSaveResult {
        base.saveIdentityKeyWithResult(keyData, forKey: scopedKey(key))
    }

    func save(key: String, data: Data, service: String, accessible: CFString?) {
        base.save(key: scopedKey(key), data: data, service: scopedService(service), accessible: accessible)
    }

    func load(key: String, service: String) -> Data? {
        base.load(key: scopedKey(key), service: scopedService(service))
    }

    func delete(key: String, service: String) {
        base.delete(key: scopedKey(key), service: scopedService(service))
    }
}
