//! Provider credentials in the OS keychain (macOS Keychain, Windows Credential
//! Manager, Linux Secret Service). One entry per provider id under the
//! `ai-convoir` service. Mobile has no keychain here, so every command returns
//! `Err` and the frontend falls back to app-local storage.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const SERVICE: &str = "ai-convoir";

/// Provider ids are short slugs from the frontend registry; reject anything else
/// so the keychain never gets arbitrary account names.
fn valid_account(account: &str) -> bool {
    !account.is_empty()
        && account.len() <= 64
        && account
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == ':')
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn run_keyring<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    // Secret Service drives its own async runtime; keep it off tokio's threads.
    std::thread::spawn(f)
        .join()
        .map_err(|_| "keychain thread panicked".to_string())?
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn get(account: &str) -> Result<Option<String>, String> {
    let account = account.to_string();
    run_keyring(move || match entry(&account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn set(account: &str, value: &str) -> Result<(), String> {
    let account = account.to_string();
    let value = value.to_string();
    run_keyring(move || {
        entry(&account)?
            .set_password(&value)
            .map_err(|e| e.to_string())
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn delete(account: &str) -> Result<(), String> {
    let account = account.to_string();
    run_keyring(move || match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn get(_account: &str) -> Result<Option<String>, String> {
    Err("keychain unavailable on mobile".into())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn set(_account: &str, _value: &str) -> Result<(), String> {
    Err("keychain unavailable on mobile".into())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn delete(_account: &str) -> Result<(), String> {
    Err("keychain unavailable on mobile".into())
}

#[tauri::command]
pub async fn secret_get(account: String) -> Result<Option<String>, String> {
    if !valid_account(&account) {
        return Err("invalid account".into());
    }
    get(&account)
}

#[tauri::command]
pub async fn secret_set(account: String, value: String) -> Result<(), String> {
    if !valid_account(&account) {
        return Err("invalid account".into());
    }
    if value.trim().is_empty() {
        return delete(&account);
    }
    set(&account, value.trim())
}

#[tauri::command]
pub async fn secret_delete(account: String) -> Result<(), String> {
    if !valid_account(&account) {
        return Err("invalid account".into());
    }
    delete(&account)
}

#[cfg(test)]
mod tests {
    use super::valid_account;

    #[test]
    fn account_names_are_slugs() {
        assert!(valid_account("openai"));
        assert!(valid_account("opencode_go"));
        assert!(valid_account("oauth:xai"));
        assert!(!valid_account(""));
        assert!(!valid_account("../etc"));
        assert!(!valid_account("a b"));
        assert!(!valid_account(&"x".repeat(65)));
    }
}
