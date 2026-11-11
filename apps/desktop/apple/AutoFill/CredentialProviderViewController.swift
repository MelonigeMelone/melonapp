import AuthenticationServices
import UIKit

final class CredentialProviderViewController: ASCredentialProviderViewController {
    private var hosts: [String] = []
    private var pendingRequest: ASCredentialRequest?
    private var parameters: ASPasskeyCredentialRequestParameters?
    private var registration = false
    private var passwords: [PasswordEntry] = []
    private let stack = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
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

    private func button(_ title: String, action: @escaping () -> Void) {
        let button = UIButton(type: .system)
        button.configuration = .filled()
        button.setTitle(title, for: .normal)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        stack.addArrangedSubview(button)
    }

    private func showUnlock() {
        guard isViewLoaded else { return }
        clear()
        button(registration ? "Passkey auf diesem Gerät erstellen" : "Mit Face ID entsperren") { [weak self] in self?.unlock() }
        button("Abbrechen") { [weak self] in self?.cancel() }
    }

    @objc private func cancel() {
        passwords.removeAll()
        clear()
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
    }

    private func fail() {
        passwords.removeAll()
        clear()
        let label = UILabel()
        label.numberOfLines = 0
        label.text = "Entsperren nicht möglich. Öffne MelonApp und aktualisiere den AutoFill-Cache."
        stack.addArrangedSubview(label)
        button("Abbrechen") { [weak self] in self?.cancel() }
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        hosts = serviceIdentifiers.compactMap { service in
            if service.type == .domain { return service.identifier.lowercased() }
            guard let url = URLComponents(string: service.identifier), url.scheme == "https" else { return nil }
            return url.host?.lowercased()
        }
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
        do {
            let vault = try CredentialVault()
            if let request = pendingRequest as? ASPasskeyCredentialRequest {
                if registration { try register(request, vault: vault) }
                else { try assertion(request, vault: vault) }
                return
            }
            if let parameters { try listPasskeys(parameters, vault: vault); return }
            if let request = pendingRequest as? ASPasswordCredentialRequest {
                guard let identity = request.credentialIdentity as? ASPasswordCredentialIdentity else { throw VaultError.invalid }
                prepareCredentialList(for: [identity.serviceIdentifier])
            }
            passwords = try vault.passwords().filter { entry in hosts.contains { entry.matches(host: $0) } }
            clear()
            if passwords.isEmpty {
                let label = UILabel()
                label.text = "Keine passenden Zugangsdaten."
                stack.addArrangedSubview(label)
            }
            for entry in passwords {
                button(entry.user.isEmpty ? "Passwort verwenden" : entry.user) { [weak self] in
                    self?.extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: entry.user, password: entry.password), completionHandler: nil)
                    self?.passwords.removeAll()
                }
            }
            button("Abbrechen") { [weak self] in self?.cancel() }
        } catch { fail() }
    }

    private func register(_ request: ASPasskeyCredentialRequest, vault: CredentialVault) throws {
        guard let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity, request.clientDataHash.count == 32,
              request.supportedAlgorithms.contains(.ES256), !identity.userHandle.isEmpty, identity.userHandle.count <= 64 else { throw VaultError.invalid }
        try vault.withKey { key in
            var stored = try vault.passkeys(key: key)
            if #available(iOS 18.0, *), let excluded = request.excludedCredentials {
                guard !stored.contains(where: { item in item.rp == identity.relyingPartyIdentifier && excluded.contains(where: { $0.credentialID == item.id }) }) else { throw VaultError.invalid }
            }
            let created = try registerPasskey(key: key, rp: identity.relyingPartyIdentifier)
            stored.append(StoredPasskey(id: created.credentialId, rp: identity.relyingPartyIdentifier, userName: identity.userName, userHandle: identity.userHandle, encryptedKey: created.encryptedKey))
            try vault.save(stored, key: key)
            let suggestion = ASPasskeyCredentialIdentity(relyingPartyIdentifier: identity.relyingPartyIdentifier, userName: identity.userName, credentialID: created.credentialId, userHandle: identity.userHandle, recordIdentifier: created.credentialId.base64EncodedString())
            ASCredentialIdentityStore.shared.saveCredentialIdentities([suggestion]) { _, _ in }
            extensionContext.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(relyingParty: identity.relyingPartyIdentifier, clientDataHash: request.clientDataHash, credentialID: created.credentialId, attestationObject: created.attestation))
        }
    }

    private func assertion(_ request: ASPasskeyCredentialRequest, vault: CredentialVault) throws {
        guard let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else { throw VaultError.invalid }
        try vault.withKey { key in
            guard let stored = try vault.passkeys(key: key).first(where: { $0.rp == identity.relyingPartyIdentifier && $0.id == identity.credentialID && $0.userHandle == identity.userHandle }) else { throw VaultError.invalid }
            try complete(stored, hash: request.clientDataHash, key: key)
        }
    }

    private func complete(_ stored: StoredPasskey, hash: Data, key: Data) throws {
        let signed = try signPasskey(key: key, rp: stored.rp, credentialId: stored.id, encryptedKey: stored.encryptedKey, clientHash: hash)
        extensionContext.completeAssertionRequest(using: ASPasskeyAssertionCredential(userHandle: stored.userHandle, relyingParty: stored.rp, signature: signed.signature, clientDataHash: hash, authenticatorData: signed.authenticatorData, credentialID: stored.id))
    }

    private func listPasskeys(_ parameters: ASPasskeyCredentialRequestParameters, vault: CredentialVault) throws {
        let matches = try vault.withKey { key in
            try vault.passkeys(key: key).filter { $0.rp == parameters.relyingPartyIdentifier && (parameters.allowedCredentials.isEmpty || parameters.allowedCredentials.contains($0.id)) }
        }
        clear()
        for stored in matches {
            button(stored.userName) { [weak self] in
                do { try vault.withKey { key in try self?.complete(stored, hash: parameters.clientDataHash, key: key) } }
                catch { self?.fail() }
            }
        }
        button("Abbrechen") { [weak self] in self?.cancel() }
    }
}
