//! Process-wide shared reqwest Client (connection pool).

use std::sync::OnceLock;
use std::time::Duration;

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Shared HTTP client for all LLM / models requests.
/// Built once per process; reuses connection pool across turns.
///
/// - `connect_timeout` fails fast on unreachable hosts.
/// - Overall `timeout` is generous so long SSE generations are not cut off mid-stream;
///   user cancel still aborts via `stream_epoch` / reset.
pub fn shared_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(900))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(4)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_client_is_singleton() {
        let a = shared_http_client() as *const _;
        let b = shared_http_client() as *const _;
        assert_eq!(a, b);
    }
}
