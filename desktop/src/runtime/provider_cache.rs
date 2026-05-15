use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CACHE_VERSION: u64 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProviderCacheMode {
    CacheFirst,
    Refresh,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProviderCacheStatus {
    Fresh,
    Cached,
    Stale,
}

impl ProviderCacheStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::Cached => "cached",
            Self::Stale => "stale",
        }
    }

    pub(crate) fn combine(self, other: Self) -> Self {
        match (self, other) {
            (Self::Stale, _) | (_, Self::Stale) => Self::Stale,
            (Self::Cached, _) | (_, Self::Cached) => Self::Cached,
            _ => Self::Fresh,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CachedProviderResponse {
    pub(crate) response: Value,
    pub(crate) cached_at: u64,
    pub(crate) status: ProviderCacheStatus,
}

#[derive(Clone, Debug)]
pub(crate) struct ProviderCacheKey {
    provider: String,
    method: String,
    normalized_url: String,
    auth_identity_hash: String,
}

impl ProviderCacheKey {
    pub(crate) fn get(provider: &str, url_or_path: &str, auth_identity_hash: &str) -> Self {
        Self {
            provider: provider.to_ascii_lowercase(),
            method: "GET".into(),
            normalized_url: normalize_url_or_path(provider, url_or_path),
            auth_identity_hash: auth_identity_hash.to_string(),
        }
    }

    fn record_key(&self) -> String {
        [
            self.provider.as_str(),
            self.method.as_str(),
            self.normalized_url.as_str(),
            self.auth_identity_hash.as_str(),
        ]
        .join("|")
    }
}

#[derive(Default, Deserialize, Serialize)]
struct ProviderCacheFile {
    version: u64,
    records: HashMap<String, ProviderCacheRecord>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCacheRecord {
    provider: String,
    method: String,
    normalized_url: String,
    auth_identity_hash: String,
    cached_at: u64,
    ttl_seconds: u64,
    response: Value,
}

pub(crate) fn stable_identity_hash(value: &str) -> String {
    let mut hasher = StableHasher::default();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn read(key: &ProviderCacheKey, ttl_seconds: u64) -> Option<CachedProviderResponse> {
    read_from_path(&cache_path(), key, ttl_seconds)
}

pub(crate) fn write(key: &ProviderCacheKey, ttl_seconds: u64, response: &Value) -> Result<(), String> {
    write_to_path(&cache_path(), key, ttl_seconds, response)
}

pub(crate) fn invalidate_provider(provider: &str) -> Result<(), String> {
    let path = cache_path();
    let mut cache = read_cache_file(&path).unwrap_or_default();
    cache.version = CACHE_VERSION;
    let provider = provider.to_ascii_lowercase();
    cache
        .records
        .retain(|_, record| !record.provider.eq_ignore_ascii_case(&provider));
    write_cache_file(&path, &cache)
}

pub(crate) fn invalidate_pull_request(provider: &str, repo: &str, pull_request: &str) -> Result<(), String> {
    let path = cache_path();
    let mut cache = read_cache_file(&path).unwrap_or_default();
    cache.version = CACHE_VERSION;
    let provider = provider.to_ascii_lowercase();
    let repo_marker = format!("/{repo}/");
    let pull_marker = format!("/pulls/{pull_request}");
    let bitbucket_marker = format!("/pullrequests/{pull_request}");
    cache.records.retain(|_, record| {
        if !record.provider.eq_ignore_ascii_case(&provider) {
            return true;
        }

        let url = record.normalized_url.as_str();
        !(url.contains(&repo_marker)
            && (url.contains(&pull_marker) || url.contains(&bitbucket_marker)))
    });
    write_cache_file(&path, &cache)
}

fn read_from_path(path: &Path, key: &ProviderCacheKey, ttl_seconds: u64) -> Option<CachedProviderResponse> {
    let cache = read_cache_file(path).ok()?;
    if cache.version != CACHE_VERSION {
        return None;
    }
    let record = cache.records.get(&key.record_key())?;
    let age = now_seconds().saturating_sub(record.cached_at);
    let effective_ttl = if ttl_seconds == 0 {
        record.ttl_seconds
    } else {
        ttl_seconds
    };
    let status = if age <= effective_ttl {
        ProviderCacheStatus::Cached
    } else {
        ProviderCacheStatus::Stale
    };

    Some(CachedProviderResponse {
        response: record.response.clone(),
        cached_at: record.cached_at,
        status,
    })
}

fn write_to_path(
    path: &Path,
    key: &ProviderCacheKey,
    ttl_seconds: u64,
    response: &Value,
) -> Result<(), String> {
    let mut cache = read_cache_file(path).unwrap_or(ProviderCacheFile {
        version: CACHE_VERSION,
        records: HashMap::new(),
    });
    cache.version = CACHE_VERSION;
    cache.records.insert(
        key.record_key(),
        ProviderCacheRecord {
            provider: key.provider.clone(),
            method: key.method.clone(),
            normalized_url: key.normalized_url.clone(),
            auth_identity_hash: key.auth_identity_hash.clone(),
            cached_at: now_seconds(),
            ttl_seconds,
            response: response.clone(),
        },
    );
    write_cache_file(path, &cache)
}

fn read_cache_file(path: &Path) -> Result<ProviderCacheFile, String> {
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn write_cache_file(path: &Path, cache: &ProviderCacheFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(cache).map_err(|error| error.to_string())?;
    fs::write(path, format!("{raw}\n")).map_err(|error| error.to_string())
}

fn cache_path() -> PathBuf {
    if let Ok(path) = std::env::var("ANVIL_PROVIDER_CACHE_PATH") {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }

    if cfg!(target_os = "macos") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("anvil")
                .join("provider-cache.json");
        }
    }

    if let Ok(config_home) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(config_home)
            .join("anvil")
            .join("provider-cache.json");
    }

    PathBuf::from(".anvil").join("provider-cache.json")
}

fn normalize_url_or_path(provider: &str, url_or_path: &str) -> String {
    let trimmed = url_or_path.trim();
    let path = strip_provider_host(provider, trimmed).unwrap_or(trimmed);
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    let mut normalized = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    if !query.is_empty() {
        let mut params = query
            .split('&')
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        params.sort();
        if !params.is_empty() {
            normalized.push('?');
            normalized.push_str(&params.join("&"));
        }
    }

    normalized
}

fn strip_provider_host<'a>(provider: &str, value: &'a str) -> Option<&'a str> {
    let lower = value.to_ascii_lowercase();
    let hosts: &[&str] = match provider.to_ascii_lowercase().as_str() {
        "github" => &["https://api.github.com"],
        "bitbucket" => &["https://api.bitbucket.org/2.0"],
        _ => &[],
    };

    for host in hosts {
        if lower.starts_with(host) {
            return Some(&value[host.len()..]);
        }
    }

    None
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[derive(Default)]
struct StableHasher(u64);

impl Hasher for StableHasher {
    fn write(&mut self, bytes: &[u8]) {
        if self.0 == 0 {
            self.0 = 0xcbf29ce484222325;
        }
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_cache_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "anvil-provider-cache-{}-{name}.json",
            std::process::id()
        ))
    }

    #[test]
    fn cache_key_normalizes_query_order_and_absolute_provider_urls() {
        let first = ProviderCacheKey::get(
            "github",
            "https://api.github.com/repos/acme/widgets/pulls?state=open&per_page=30",
            "auth-a",
        );
        let second = ProviderCacheKey::get(
            "github",
            "/repos/acme/widgets/pulls?per_page=30&state=open",
            "auth-a",
        );

        assert_eq!(first.record_key(), second.record_key());
    }

    #[test]
    fn ttl_expiry_returns_stale_reads() {
        let path = temp_cache_path("ttl");
        let key = ProviderCacheKey::get("github", "/user", "auth-a");
        write_to_path(&path, &key, 0, &serde_json::json!({ "login": "lane" })).unwrap();
        let mut cache = read_cache_file(&path).unwrap();
        cache
            .records
            .get_mut(&key.record_key())
            .unwrap()
            .cached_at = 1;
        write_cache_file(&path, &cache).unwrap();

        let cached = read_from_path(&path, &key, 0).unwrap();
        assert_eq!(cached.status, ProviderCacheStatus::Stale);
        assert_eq!(cached.response["login"], "lane");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn auth_identity_separates_records() {
        let path = temp_cache_path("auth");
        let first = ProviderCacheKey::get("github", "/user", "auth-a");
        let second = ProviderCacheKey::get("github", "/user", "auth-b");
        write_to_path(&path, &first, 60, &serde_json::json!({ "login": "lane" })).unwrap();
        write_to_path(&path, &second, 60, &serde_json::json!({ "login": "other" })).unwrap();

        assert_eq!(read_from_path(&path, &first, 60).unwrap().response["login"], "lane");
        assert_eq!(read_from_path(&path, &second, 60).unwrap().response["login"], "other");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn corrupt_json_recovers_on_write() {
        let path = temp_cache_path("corrupt");
        fs::write(&path, "{not-json").unwrap();
        let key = ProviderCacheKey::get("bitbucket", "/user", "auth-a");

        write_to_path(&path, &key, 60, &serde_json::json!({ "nickname": "lane" })).unwrap();

        assert_eq!(
            read_from_path(&path, &key, 60).unwrap().response["nickname"],
            "lane"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn post_paths_are_not_cached_by_cache_module() {
        let path = temp_cache_path("post");
        let cache = ProviderCacheFile {
            version: CACHE_VERSION,
            records: HashMap::new(),
        };
        write_cache_file(&path, &cache).unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("\"POST\""));
        let _ = fs::remove_file(path);
    }
}
