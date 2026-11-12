import AuthenticationServices
import UIKit

final class CancellationFlag {
    private let lock = NSLock()
    private var value = false
    func cancel() { lock.lock(); value = true; lock.unlock() }
    func check() throws { lock.lock(); defer { lock.unlock() }; if value { throw VaultError.unavailable } }
}

private enum UnlockedCredentials {
    case passwords([PasswordEntry])
    case passkeys([StoredPasskey], ASPasskeyCredentialRequestParameters, CredentialVault)
    case registration(ASPasskeyRegistrationCredential)
    case assertion(ASPasskeyAssertionCredential)
}

enum MelonTheme {
    static let background = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x05 / 255, green: 0x06 / 255, blue: 0x0A / 255, alpha: 1)
            : UIColor(red: 0xF4 / 255, green: 0xF5 / 255, blue: 0xFA / 255, alpha: 1)
    }
    static let accent = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x96 / 255, green: 0x86 / 255, blue: 0xFF / 255, alpha: 1)
            : UIColor(red: 0x5B / 255, green: 0x45 / 255, blue: 0xF0 / 255, alpha: 1)
    }
    static let onAccent = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x0A / 255, green: 0x08 / 255, blue: 0x18 / 255, alpha: 1)
            : UIColor.white
    }
}

final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let cancellation = CancellationFlag()
    private var hosts: [String] = []
    private var pendingRequest: ASCredentialRequest?
    private var parameters: ASPasskeyCredentialRequestParameters?
    private var registration = false
    private var passwords: [PasswordEntry] = []
    private let stack = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MelonTheme.background
        view.tintColor = MelonTheme.accent
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
        ])
        showUnlock()
        NotificationCenter.default.addObserver(self, selector: #selector(cancel), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        passwords.removeAll()
        clear()
    }

    private func clear() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    }

    private func button(_ title: String, primary: Bool = true, action: @escaping () -> Void) {
        let button = UIButton(type: .system)
        var configuration: UIButton.Configuration = primary ? .filled() : .tinted()
        configuration.cornerStyle = .capsule
        configuration.buttonSize = .large
        if primary { configuration.baseForegroundColor = MelonTheme.onAccent }
        button.configuration = configuration
        button.setTitle(title, for: .normal)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        stack.addArrangedSubview(button)
    }

    private func showUnlock() {
        guard isViewLoaded else { return }
        clear()
        button(registration ? "Passkey auf diesem Gerät erstellen" : "Mit Face ID entsperren") { [weak self] in self?.unlock() }
        button("Abbrechen", primary: false) { [weak self] in self?.cancel() }
    }

    @objc private func cancel() {
        cancellation.cancel()
        passwords.removeAll()
        clear()
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
    }

    private func fail() {
        passwords.removeAll()
        clear()
        let label = UILabel()
        label.textColor = .secondaryLabel
        label.numberOfLines = 0
        label.text = "Entsperren nicht möglich. Öffne MelonApp und aktualisiere den AutoFill-Cache."
        stack.addArrangedSubview(label)
        button("Abbrechen", primary: false) { [weak self] in self?.cancel() }
    }

    private static func hosts(for identifiers: [ASCredentialServiceIdentifier]) -> [String] {
        identifiers.compactMap { service in
            if service.type == .domain { return service.identifier.lowercased() }
            guard let url = URLComponents(string: service.identifier), url.scheme == "https" else { return nil }
            return url.host?.lowercased()
        }
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        hosts = Self.hosts(for: serviceIdentifiers)
        pendingRequest = nil
        parameters = nil
        registration = false
        showUnlock()
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier], requestParameters: ASPasskeyCredentialRequestParameters) {
        prepareCredentialList(for: serviceIdentifiers)
        parameters = requestParameters
    }

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: ASCredentialRequest) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        prepareCredentialList(for: [credentialIdentity.serviceIdentifier])
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: ASCredentialRequest) {
        pendingRequest = credentialRequest
        registration = false
        showUnlock()
    }

    override func prepareInterface(forPasskeyRegistration registrationRequest: ASCredentialRequest) {
        pendingRequest = registrationRequest
        registration = true
        showUnlock()
    }

    private func unlock() {
        let request = pendingRequest
        let parameters = parameters
        let registration = registration
        let hosts = hosts
        clear()
        let label = UILabel()
        label.textColor = .secondaryLabel
        label.text = "Zugangsdaten werden entsperrt …"
        stack.addArrangedSubview(label)
        button("Abbrechen", primary: false) { [weak self] in self?.cancel() }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let vault = try CredentialVault()
                let result: UnlockedCredentials
                if let request = request as? ASPasskeyCredentialRequest {
                    result = registration ? .registration(try self.register(request, vault: vault)) : .assertion(try self.assertion(request, vault: vault))
                } else if let parameters {
                    let matches = try vault.withKey { key in
                        try self.cancellation.check()
                        return vault.passkeys(key: key).filter { $0.rp == parameters.relyingPartyIdentifier && (parameters.allowedCredentials.isEmpty || parameters.allowedCredentials.contains($0.id)) }
                    }
                    result = .passkeys(matches, parameters, vault)
                } else {
                    var requiredHosts = hosts
                    if let request = request as? ASPasswordCredentialRequest {
                        guard let identity = request.credentialIdentity as? ASPasswordCredentialIdentity else { throw VaultError.invalid }
                        requiredHosts = Self.hosts(for: [identity.serviceIdentifier])
                    }
                    result = .passwords(try vault.passwords().filter { entry in requiredHosts.contains { entry.matches(host: $0) } })
                }
                try self.cancellation.check()
                DispatchQueue.main.async { [weak self] in
                    guard let self, (try? self.cancellation.check()) != nil else { return }
                    self.present(result)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    guard let self, (try? self.cancellation.check()) != nil else { return }
                    self.fail()
                }
            }
        }
    }

    private func present(_ result: UnlockedCredentials) {
        clear()
        switch result {
        case .registration(let credential):
            extensionContext.completeRegistrationRequest(using: credential)
            return
        case .assertion(let credential):
            extensionContext.completeAssertionRequest(using: credential)
            return
        case .passwords(let entries):
            passwords = entries
            for entry in entries {
                button(entry.user.isEmpty ? "Passwort verwenden" : entry.user) { [weak self] in
                    guard let self, (try? self.cancellation.check()) != nil else { return }
                    self.extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: entry.user, password: entry.password), completionHandler: nil)
                    self.passwords.removeAll()
                    self.clear()
                }
            }
        case .passkeys(let matches, let parameters, let vault):
            for stored in matches {
                button(stored.userName) { [weak self] in
                    guard let self else { return }
                    DispatchQueue.global(qos: .userInitiated).async {
                        do {
                            let credential = try vault.withKey { key in
                                try self.cancellation.check()
                                return try self.complete(stored, hash: parameters.clientDataHash, key: key)
                            }
                            DispatchQueue.main.async {
                                guard (try? self.cancellation.check()) != nil else { return }
                                self.extensionContext.completeAssertionRequest(using: credential)
                            }
                        } catch { DispatchQueue.main.async { self.fail() } }
                    }
                }
            }
        }
        if stack.arrangedSubviews.isEmpty {
            let label = UILabel()
        label.textColor = .secondaryLabel
            label.text = "Keine passenden Zugangsdaten."
            stack.addArrangedSubview(label)
        }
        button("Abbrechen", primary: false) { [weak self] in self?.cancel() }
    }

    private func register(_ request: ASPasskeyCredentialRequest, vault: CredentialVault) throws -> ASPasskeyRegistrationCredential {
        guard let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity, request.clientDataHash.count == 32,
              request.supportedAlgorithms.contains(.ES256), !identity.userHandle.isEmpty, identity.userHandle.count <= 64 else { throw VaultError.invalid }
        return try vault.withKey { key in
            try cancellation.check()
            let stored = vault.passkeys(key: key)
            if #available(iOS 18.0, *), let excluded = request.excludedCredentials {
                guard !stored.contains(where: { item in item.rp == identity.relyingPartyIdentifier && excluded.contains(where: { $0.credentialID == item.id }) }) else { throw VaultError.invalid }
            }
            let created = try registerPasskey(key: key, rp: identity.relyingPartyIdentifier)
            try vault.saveOutbox(StoredPasskey(id: created.credentialId, rp: identity.relyingPartyIdentifier, userName: identity.userName, userHandle: identity.userHandle, encryptedKey: created.encryptedKey), key: key)
            let suggestion = ASPasskeyCredentialIdentity(relyingPartyIdentifier: identity.relyingPartyIdentifier, userName: identity.userName, credentialID: created.credentialId, userHandle: identity.userHandle, recordIdentifier: created.credentialId.base64EncodedString())
            ASCredentialIdentityStore.shared.saveCredentialIdentities([suggestion]) { _, _ in }
            return ASPasskeyRegistrationCredential(relyingParty: identity.relyingPartyIdentifier, clientDataHash: request.clientDataHash, credentialID: created.credentialId, attestationObject: created.attestation)
        }
    }

    private func assertion(_ request: ASPasskeyCredentialRequest, vault: CredentialVault) throws -> ASPasskeyAssertionCredential {
        guard let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else { throw VaultError.invalid }
        return try vault.withKey { key in
            try cancellation.check()
            guard let stored = vault.passkeys(key: key).first(where: { $0.rp == identity.relyingPartyIdentifier && $0.id == identity.credentialID && $0.userHandle == identity.userHandle }) else { throw VaultError.invalid }
            return try complete(stored, hash: request.clientDataHash, key: key)
        }
    }

    private func complete(_ stored: StoredPasskey, hash: Data, key: Data) throws -> ASPasskeyAssertionCredential {
        let signed = try signPasskey(key: key, rp: stored.rp, credentialId: stored.id, encryptedKey: stored.encryptedKey, clientHash: hash)
        return ASPasskeyAssertionCredential(userHandle: stored.userHandle, relyingParty: stored.rp, signature: signed.signature, clientDataHash: hash, authenticatorData: signed.authenticatorData, credentialID: stored.id)
    }

}
