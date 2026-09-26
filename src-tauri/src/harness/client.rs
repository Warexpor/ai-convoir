//! Process-wide shared reqwest clients (connection pools).

use std::sync::OnceLock;
use std::time::Duration;

/// Timeout for fetch_models / non-stream JSON calls (fail fast).
pub const SHORT_HTTP_TIMEOUT_SECS: u64 = 30;
/// Timeout for SSE bodies (long generations).
pub const STREAM_HTTP_TIMEOUT_SECS: u64 = 900;

static SHORT_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static STREAM_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn build_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(timeout_secs))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(4)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Short-timeout client for models list and non-stream completions.
pub fn short_http_client() -> &'static reqwest::Client {
    SHORT_HTTP_CLIENT.get_or_init(|| build_client(SHORT_HTTP_TIMEOUT_SECS))
}

/// Long-timeout client for SSE streams only.
pub fn stream_http_client() -> &'static reqwest::Client {
    STREAM_HTTP_CLIENT.get_or_init(|| build_client(STREAM_HTTP_TIMEOUT_SECS))
}

/// Alias for the stream client (historical name used by call sites / re-exports).
#[allow(dead_code)]
pub fn shared_http_client() -> &'static reqwest::Client {
    stream_http_client()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_client_is_singleton() {
        let a = stream_http_client() as *const _;
        let b = stream_http_client() as *const _;
        assert_eq!(a, b);
    }

    #[test]
    fn short_client_is_singleton() {
        let a = short_http_client() as *const _;
        let b = short_http_client() as *const _;
        assert_eq!(a, b);
    }

    #[test]
    fn short_timeout_is_not_stream_budget() {
        assert_eq!(SHORT_HTTP_TIMEOUT_SECS, 30);
        assert_eq!(STREAM_HTTP_TIMEOUT_SECS, 900);
        assert!(SHORT_HTTP_TIMEOUT_SECS < STREAM_HTTP_TIMEOUT_SECS);
        // Distinct pool instances (short vs stream).
        assert_ne!(
            short_http_client() as *const _,
            stream_http_client() as *const _
        );
    }
}
