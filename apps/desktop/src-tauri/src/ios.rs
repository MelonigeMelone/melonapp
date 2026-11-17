#![allow(unsafe_code)]

use std::{fs, os::fd::AsRawFd};

const F_SETPROTECTIONCLASS: libc::c_int = 64;
const PROTECTION_COMPLETE: libc::c_int = 1;

pub fn protect(file: &fs::File) -> Result<(), String> {
    let result =
        unsafe { libc::fcntl(file.as_raw_fd(), F_SETPROTECTIONCLASS, PROTECTION_COMPLETE) };
    if result != 0 && cfg!(not(target_abi = "sim")) {
        return Err("storage_unavailable".into());
    }
    Ok(())
}

pub fn clear_suggestions() {
    use objc2_authentication_services::ASCredentialIdentityStore;
    unsafe {
        ASCredentialIdentityStore::sharedStore().removeAllCredentialIdentitiesWithCompletion(None);
    }
}
