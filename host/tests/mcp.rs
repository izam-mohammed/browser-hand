use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use browser_hand::mcp::{Launcher, Server, EXTENSION_ID};
use browser_hand::tools::args::{NavigateArgs, SelectProfileArgs, TabsContextArgs};
use browser_hand::native_host;
use browser_hand::wire::{self, Content, Frame};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use serde_json::Value;
use tokio::net::UnixListener;

/// A native host on `<sockets>/<n>.sock` whose "Chrome" end says hello as
/// `hello_dir` (and `claimed` as `claim_dir` when set), then answers every
/// call with `<tool> <args>` as text. Returns the sessions it was told to
/// `end`.
fn fake_profile(sockets: &Path, n: u32, hello_dir: Option<&str>, claim_dir: Option<&str>) -> Arc<Mutex<Vec<String>>> {
    let listener = UnixListener::bind(sockets.join(format!("{n}.sock"))).unwrap();
    let (chrome, host) = tokio::io::duplex(1 << 20);
    let (hr, hw) = tokio::io::split(host);
    tokio::spawn(native_host::run(hr, hw, listener, format!("inst-{n}")));
    let hello_dir = hello_dir.map(String::from);
    let claim_dir = claim_dir.map(String::from);
    let ends: Arc<Mutex<Vec<String>>> = Arc::default();
    let ended = ends.clone();
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
            if let Frame::End { session } = &frame {
                ended.lock().unwrap().push(session.clone());
            }
            if let Frame::Call { id, tool, args, .. } = frame {
                let reply = if tool == "computer" && args["action"] == "screenshot" {
                    Frame::ok(
                        id,
                        vec![
                            Content::Text { text: "Screenshot of tab 1: viewport 100x50 CSS px; image 60x30 (scale 0.600).".into() },
                            Content::Image { data: tiny_png(), mime_type: "image/png".into(), image_id: None },
                        ],
                    )
                } else {
                    Frame::ok(id, vec![Content::Text { text: format!("{tool} {args}") }])
                };
                wire::write_frame(&mut w, &reply).await.unwrap();
            }
        }
    });
    ends
}

/// A 60x30 grey PNG, base64.
pub fn tiny_png() -> String {
    use base64::Engine;
    let img = image::RgbaImage::from_pixel(60, 30, image::Rgba([128, 128, 128, 255]));
    let mut bytes = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
    base64::engine::general_purpose::STANDARD.encode(bytes)
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
                let _ = fake_profile(&sockets, 900, None, Some(dir));
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
async fn selecting_the_bound_profile_again_keeps_the_session_and_its_tab_group() {
    // A second connection used to replace the first, and the host then sent
    // `end` for the session, so the extension forgot its tab group.
    let s = Setup::new();
    let ends = fake_profile(s.sockets.path(), 1, Some("Profile 3"), None);
    let server = s.server(false);
    server.select_profile(Parameters(SelectProfileArgs { profile: "work".into() })).await.unwrap();
    server.tabs_create().await.unwrap();
    let r = server.select_profile(Parameters(SelectProfileArgs { profile: "Profile 3".into() })).await.unwrap();
    assert!(!is_error(&r), "{}", text(&r));
    server.tabs_create().await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(ends.lock().unwrap().is_empty(), "ended {:?}", ends.lock().unwrap());
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

mod more {
    use super::*;
    use browser_hand::tools::args::*;

    fn all_text(r: &CallToolResult) -> String {
        let v = serde_json::to_value(r).unwrap();
        v["content"].as_array().unwrap().iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n")
    }

    fn computer(action: ComputerAction) -> ComputerArgs {
        ComputerArgs {
            action,
            tab_id: 1,
            coordinate: None,
            start_coordinate: None,
            reference: None,
            text: None,
            duration: None,
            scroll_direction: None,
            scroll_amount: None,
            modifiers: None,
            repeat: None,
            region: None,
            scale: None,
            save_to_disk: None,
            action_summary: None,
        }
    }

    async fn connected() -> (Setup, Server) {
        let s = Setup::new();
        fake_profile(s.sockets.path(), 1, Some("Profile 3"), None);
        let server = s.server(false);
        (s, server)
    }

    #[tokio::test]
    async fn computer_passes_the_pace_and_screenshots_get_an_image_id() {
        let (_s, server) = connected().await;
        let r = server.computer(Parameters(ComputerArgs { coordinate: Some([5.0, 6.0]), ..computer(ComputerAction::LeftClick) })).await.unwrap();
        assert!(text(&r).contains(r#""pace":"human""#), "{}", text(&r));

        let r = server.computer(Parameters(computer(ComputerAction::Screenshot))).await.unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["content"][1]["type"], "image");
        assert!(all_text(&r).contains("imageId: img_1"));
    }

    #[tokio::test]
    async fn upload_image_sends_the_kept_screenshot_and_refuses_unknown_ids() {
        let (_s, server) = connected().await;
        server.computer(Parameters(computer(ComputerAction::Screenshot))).await.unwrap();
        let args = |id: &str| UploadImageArgs { image_id: id.into(), tab_id: 1, reference: Some("ref_2".into()), coordinate: None, filename: None };
        let r = server.upload_image(Parameters(args("img_1"))).await.unwrap();
        let t = text(&r);
        assert!(t.starts_with("upload_image "), "{t}");
        assert!(t.contains(&tiny_png()) && t.contains(r#""filename":"image.png""#), "{t}");
        let r = server.upload_image(Parameters(args("img_9"))).await.unwrap();
        assert!(is_error(&r) && text(&r).contains("fresh screenshot"));
    }

    #[tokio::test]
    async fn out_of_range_inputs_are_refused_before_reaching_the_browser() {
        let (_s, server) = connected().await;
        let r = server.computer(Parameters(ComputerArgs { repeat: Some(101), text: Some("Enter".into()), ..computer(ComputerAction::Key) })).await.unwrap();
        assert!(is_error(&r) && text(&r).contains("repeat"));
        let r = server.computer(Parameters(ComputerArgs { duration: Some(11.0), ..computer(ComputerAction::Wait) })).await.unwrap();
        assert!(is_error(&r) && text(&r).contains("duration"));
        for amount in [0, 11] {
            let r = server
                .computer(Parameters(ComputerArgs {
                    coordinate: Some([5.0, 6.0]),
                    scroll_direction: Some(ScrollDirection::Down),
                    scroll_amount: Some(amount),
                    ..computer(ComputerAction::Scroll)
                }))
                .await
                .unwrap();
            assert!(is_error(&r) && text(&r).contains("scroll_amount"), "{}", text(&r));
        }
    }

    #[tokio::test]
    async fn file_upload_reads_files_and_refuses_relative_paths() {
        let (_s, server) = connected().await;
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("note.txt");
        std::fs::write(&f, "hello").unwrap();
        let r = server
            .file_upload(Parameters(FileUploadArgs { paths: vec![f.display().to_string()], reference: "ref_1".into(), tab_id: 1 }))
            .await
            .unwrap();
        let t = text(&r);
        assert!(t.contains(r#""name":"note.txt""#) && t.contains(r#""mimeType":"text/plain""#) && t.contains("aGVsbG8="), "{t}");
        let r = server.file_upload(Parameters(FileUploadArgs { paths: vec!["note.txt".into()], reference: "ref_1".into(), tab_id: 1 })).await.unwrap();
        assert!(is_error(&r) && text(&r).contains("absolute"));
    }

    #[tokio::test]
    async fn a_batch_runs_in_order_strips_prefixes_and_stops_at_the_first_error() {
        let (_s, server) = connected().await;
        // "fail" is no tool, so the second item fails before reaching the browser.
        let items = vec![
            BatchItem { name: "mcp__browser-hand__find".into(), input: serde_json::json!({ "query": "go", "tabId": 1 }) },
            BatchItem { name: "fail".into(), input: serde_json::json!({}) },
            BatchItem { name: "get_page_text".into(), input: serde_json::json!({ "tabId": 1 }) },
        ];
        let r = server.browser_batch(Parameters(BatchArgs { actions: items })).await.unwrap();
        let t = all_text(&r);
        assert!(t.contains("[1/3] find: ok"), "{t}");
        assert!(t.contains("[2/3] fail failed, batch stopped"), "{t}");
        assert!(!t.contains("get_page_text"), "{t}");
        assert!(is_error(&r), "a stopped batch is an error result");
    }

    #[tokio::test]
    async fn a_batch_cannot_nest() {
        let (_s, server) = connected().await;
        let items = vec![BatchItem { name: "browser_batch".into(), input: serde_json::json!({ "actions": [] }) }];
        let r = server.browser_batch(Parameters(BatchArgs { actions: items })).await.unwrap();
        assert!(is_error(&r) && text(&r).contains("cannot be nested"));
    }

    #[tokio::test]
    async fn a_recording_takes_a_frame_per_action_and_exports_a_gif() {
        let out = tempfile::tempdir().unwrap();
        std::env::set_var("BROWSER_HAND_OUTPUT_DIR", out.path());
        let (_s, server) = connected().await;
        let gif = |action| GifArgs { action, tab_id: 1, download: None, filename: Some("walk".into()), options: None };

        let r = server.gif_creator(Parameters(gif(GifAction::StartRecording))).await.unwrap();
        assert!(text(&r).contains("1 frame"), "{}", text(&r));
        server
            .computer(Parameters(ComputerArgs { coordinate: Some([50.0, 25.0]), action_summary: Some("Clicks Go".into()), ..computer(ComputerAction::LeftClick) }))
            .await
            .unwrap();
        server.computer(Parameters(computer(ComputerAction::Screenshot))).await.unwrap(); // no frame
        let r = server.gif_creator(Parameters(gif(GifAction::StopRecording))).await.unwrap();
        assert!(text(&r).contains("2 frame(s)"), "{}", text(&r));

        let r = server.gif_creator(Parameters(gif(GifAction::Export))).await.unwrap();
        assert!(!is_error(&r), "{}", text(&r));
        let bytes = std::fs::read(out.path().join("walk.gif")).unwrap();
        assert_eq!(&bytes[..6], b"GIF89a");
    }
}
