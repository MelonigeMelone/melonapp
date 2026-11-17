const SERVER_SERVICE: &str = "de.melonigemelone.app.server.v1";

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use super::SERVER_SERVICE;
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        passwords::{self, AccessControlOptions, PasswordOptions},
    };
    use std::path::Path;
    use zeroize::Zeroizing;

    const SERVICE: &str = "de.melonigemelone.app.biometric.v1";
    const NOT_FOUND: i32 = -25300;

    fn server_item() -> PasswordOptions {
        PasswordOptions::new_generic_password(SERVER_SERVICE, "server")
    }

    fn biometric_item(scope: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, scope);
        options.use_protected_keychain();
        options.set_access_synchronized(Some(false));
        options
    }

    pub fn load_server() -> Result<Vec<u8>, String> {
        passwords::generic_password(server_item()).map_err(|_| "server_not_set".into())
    }

    pub fn save_server(value: &str) -> Result<(), String> {
        if passwords::delete_generic_password_options(server_item())
            .is_err_and(|e| e.code() != NOT_FOUND)
        {
            return Err("server_unavailable".into());
        }
        passwords::set_generic_password_options(value.as_bytes(), server_item())
            .map_err(|_| "server_unavailable".into())
    }

    pub fn biometric_available() -> bool {
        true
    }

    pub fn save_biometric(_file: &Path, scope: &str, key: &[u8]) -> Result<(), String> {
        let access = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenPasscodeSetThisDeviceOnly),
            AccessControlOptions::BIOMETRY_CURRENT_SET.bits(),
        )
        .map_err(|_| "biometric_unavailable")?;
        let mut config = biometric_item(scope);
        config.set_access_control(access);
        delete_biometric(_file, scope)?;
        passwords::set_generic_password_options(key, config)
            .map_err(|_| "biometric_unavailable".into())
    }

    pub fn load_biometric(_file: &Path, scope: &str) -> Result<Zeroizing<Vec<u8>>, String> {
        passwords::generic_password(biometric_item(scope))
            .map(Zeroizing::new)
            .map_err(|_| "biometric_unavailable".into())
    }

    pub fn delete_biometric(_file: &Path, scope: &str) -> Result<(), String> {
        if passwords::delete_generic_password_options(biometric_item(scope))
            .is_err_and(|e| e.code() != NOT_FOUND)
        {
            return Err("biometric_unavailable".into());
        }
        Ok(())
    }
}

#[cfg(windows)]
mod imp {
    use super::SERVER_SERVICE;
    use crate::hello;
    use std::{fs, path::Path};
    use zeroize::Zeroizing;

    fn server_entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVER_SERVICE, "server").map_err(|_| "server_unavailable".into())
    }

    pub fn load_server() -> Result<Vec<u8>, String> {
        server_entry()?
            .get_password()
            .map(String::into_bytes)
            .map_err(|_| "server_not_set".into())
    }

    pub fn save_server(value: &str) -> Result<(), String> {
        server_entry()?
            .set_password(value)
            .map_err(|_| "server_unavailable".into())
    }

    pub fn biometric_available() -> bool {
        hello::system::available()
    }

    pub fn save_biometric(file: &Path, scope: &str, key: &[u8]) -> Result<(), String> {
        let sealed = hello::seal(scope, key, |challenge| hello::system::sign(challenge, true))?;
        crate::platform::atomic_write(file, sealed.as_bytes())
    }

    pub fn load_biometric(file: &Path, scope: &str) -> Result<Zeroizing<Vec<u8>>, String> {
        let sealed = fs::read_to_string(file).map_err(|_| "biometric_unavailable")?;
        hello::open(scope, &sealed, |challenge| {
            hello::system::sign(challenge, false)
        })
    }

    pub fn delete_biometric(file: &Path, _scope: &str) -> Result<(), String> {
        hello::system::delete();
        match fs::remove_file(file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err("storage_unavailable".into())
            }
            _ => Ok(()),
        }
    }
}

pub use imp::{
    biometric_available, delete_biometric, load_biometric, load_server, save_biometric, save_server,
};
