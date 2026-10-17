use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use browser_hand::mcp::{Launcher, NavigateArgs, SelectProfileArgs, Server, TabsContextArgs, EXTENSION_ID};
use browser_hand::native_host;
use browser_hand::wire::{self, Content, Frame};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use serde_json::Value;
use tokio::net::UnixListener;

/// A native host on `<sockets>/<n>.sock` whose "Chrome" end says hello as
/// `hello_dir` (and `claimed` as `claim_dir` when set), then answers every
/// call with `<tool> <args>` as text.
fn fake_profile(sockets: &Path, n: u32, hello_dir: Option<&str>, claim_dir: Option<&str>) {
    let listener = UnixListener::bind(sockets.join(format!("{n}.sock"))).unwrap();
    let (chrome, host) = tokio::io::duplex(1 << 20);
    let (hr, hw) = tokio::io::split(host);
    tokio::spawn(native_host::run(hr, hw, listener, format!("inst-{n}")));
    let hello_dir = hello_dir.map(String::from);
    let claim_dir = claim_dir.map(String::from);
    tokio::spawn(async move {
        let (mut r, mut w) = tokio::io::split(chrome);
        let hello = Frame::Hello {
            protocol: 1,
            profile_dir: hello_dir,
            extension_version: "0.1.0".into(),
            instance: String::new(),
        };
        wire::write_frame(&mut w, &hello).await.unwrap();
        if let Some(dir) = claim_dir {
            wire::write_frame(&mut w, &Frame::Claimed { profile_dir: dir, nonce: "n".into() }).await.unwrap();
        }
        while let Ok(Some(frame)) = wire::read_frame(&mut r).await {
            if let Frame::Call { id, tool, args, .. } = frame {
                let reply = Frame::ok(id, vec![Content::Text { text: format!("{tool} {args}") }]);
                wire::write_frame(&mut w, &reply).await.unwrap();
            }
        }
    });
}

struct Setup {
    _chrome: tempfile::TempDir,
    sockets: tempfile::TempDir,
    launched: Arc<Mutex<Vec<(String, String)>>>,
}

impl Setup {
    fn new() -> Self {
        let chrome = tempfile::tempdir().unwrap();
        std::fs::copy(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/local-state.json"),
            chrome.path().join("Local State"),
        )
        .unwrap();
        Setup { _chrome: chrome, sockets: tempfile::tempdir().unwrap(), launched: Arc::default() }
    }

    fn chrome_dir(&self) -> PathBuf {
        self._chrome.path().to_owned()
    }

    /// A server whose launcher records the launch and, when `claim` is set,
    /// brings up a host for that profile as the claim page would.
    fn server(&self, claim: bool) -> Server {
        let launched = self.launched.clone();
        let sockets = self.sockets.path().to_owned();
        let launch: Launcher = Arc::new(move |dir: &str, url: &str| {
            launched.lock().unwrap().push((dir.to_owned(), url.to_owned()));
            if claim {
                fake_profile(&sockets, 900, None, Some(dir));
            }
            Ok(false)
        });
        Server::new(self.chrome_dir(), self.sockets.path().to_owned(), launch)
    }
}

fn text(r: &CallToolResult) -> String {
    let v = serde_json::to_value(r).unwrap();
    v["content"][0]["text"].as_str().unwrap_or_default().to_owned()
}

fn is_error(r: &CallToolResult) -> bool {
    serde_json::to_value(r).unwrap()["isError"].as_bool().unwrap_or(false)
}

fn json(r: &CallToolResult) -> Value {
    serde_json::from_str(&text(r)).unwrap()
}

#[test]
fn extension_id_matches_the_manifest_key() {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let manifest: Value = serde_json::from_str(include_str!("../../extension/manifest.json")).unwrap();
    let key = base64::engine::general_purpose::STANDARD.decode(manifest["key"].as_str().unwrap()).unwrap();
    let digest = Sha256::digest(&key);
    let id: String = digest[..16]
        .iter()
        .flat_map(|b| [b >> 4, b & 0xf])
        .map(|n| (b'a' + n) as char)
        .collect();
    assert_eq!(id, EXTENSION_ID);
}

#[tokio::test]
async fn list_profiles_marks_which_are_connected() {
    let s = Setup::new();
    fake_profile(s.sockets.path(), 1, Some("Profile 3"), None);
    fake_profile(s.sockets.path(), 2, None, None);
    let r = s.server(false).list_profiles().await.unwrap();
    let v = json(&r);
    let connected: Vec<(&str, bool)> = v["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["name"].as_str().unwrap(), p["connected"].as_bool().unwrap()))
        .collect();
    assert_eq!(connected, vec![("Personal", false), ("Work", true), ("Testing", false)]);
    assert_eq!(v["unclaimedConnections"], 1);
}

#[tokio::test]
async fn selecting_a_connected_profile_by_name_forwards_tab_calls_to_it() {
    let s = Setup::new();
    fake_profile(s.sockets.path(), 1, Some("Profile 3"), None);
    let server = s.server(false);
    let r = server.select_profile(Parameters(SelectProfileArgs { profile: "work".into() })).await.unwrap();
    assert!(!is_error(&r), "{}", text(&r));
    assert!(s.launched.lock().unwrap().is_empty(), "no launch for a connected profile");

    let r = server.tabs_context(Parameters(TabsContextArgs { create_if_empty: Some(true) })).await.unwrap();
    assert_eq!(text(&r), r#"tabs_context {"createIfEmpty":true}"#);
    let r = server.navigate(Parameters(NavigateArgs { url: "example.com".into(), tab_id: Some(7) })).await.unwrap();
    assert_eq!(text(&r), r#"navigate {"tabId":7,"url":"example.com"}"#);
}

#[tokio::test]
async fn selecting_an_unconnected_profile_launches_the_claim_page_and_waits() {
    let s = Setup::new();
    let server = s.server(true);
    let r = server.select_profile(Parameters(SelectProfileArgs { profile: "Personal".into() })).await.unwrap();
    assert!(!is_error(&r), "{}", text(&r));
    let launched = s.launched.lock().unwrap().clone();
    assert_eq!(launched.len(), 1);
    assert_eq!(launched[0].0, "Default");
    assert!(launched[0].1.starts_with(&format!("chrome-extension://{EXTENSION_ID}/claim.html#dir=Default&nonce=")));
    let r = server.tabs_create().await.unwrap();
    assert_eq!(text(&r), "tabs_create {}");
}

#[tokio::test]
async fn the_claim_url_encodes_spaces_in_the_dir() {
    let s = Setup::new();
    let server = s.server(true);
    server.select_profile(Parameters(SelectProfileArgs { profile: "Testing".into() })).await.unwrap();
    assert!(s.launched.lock().unwrap()[0].1.contains("#dir=Profile%204&nonce="));
}

#[tokio::test]
async fn an_unknown_profile_is_an_error_listing_the_profiles() {
    let s = Setup::new();
    let r = s.server(false).select_profile(Parameters(SelectProfileArgs { profile: "Nope".into() })).await.unwrap();
    assert!(is_error(&r));
    assert!(text(&r).contains("Work (Profile 3)"));
}

#[tokio::test]
async fn with_one_connected_profile_tab_tools_bind_it_without_asking() {
    let s = Setup::new();
    fake_profile(s.sockets.path(), 1, Some("Profile 4"), None);
    let r = s.server(false).tabs_create().await.unwrap();
    assert_eq!(text(&r), "tabs_create {}");
}

#[tokio::test]
async fn with_several_connected_profiles_tab_tools_refuse_to_guess() {
    let s = Setup::new();
    fake_profile(s.sockets.path(), 1, Some("Profile 3"), None);
    fake_profile(s.sockets.path(), 2, Some("Default"), None);
    let r = s.server(false).tabs_create().await.unwrap();
    assert!(is_error(&r));
    assert!(text(&r).contains("select_profile"));
}

#[tokio::test]
async fn opening_a_profile_whose_extension_never_answers_says_what_happened() {
    let s = Setup::new();
    // Chrome "starts" but nothing claims: the wait is the cold one (30 s),
    // so pause time and let tokio run the clock forward.
    tokio::time::pause();
    let launch: Launcher = Arc::new(|_: &str, _: &str| Ok(true));
    let server = Server::new(s.chrome_dir(), s.sockets.path().to_owned(), launch);
    let r = server.select_profile(Parameters(SelectProfileArgs { profile: "Work".into() })).await.unwrap();
    assert!(is_error(&r));
    let t = text(&r);
    assert!(t.contains("after starting Chrome"), "{t}");
    assert!(t.contains("within 30 s"), "{t}");
    assert!(t.contains("Load unpacked"), "{t}");
}
