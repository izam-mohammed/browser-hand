// list_profiles and select_profile over two browsers (plans/14, decision 2).

use std::path::Path;
use std::sync::{Arc, Mutex};

use browser_hand::mcp::{Launcher, Server, ServerOptions};
use browser_hand::profiles::Root;
use rmcp::model::CallToolResult;
use serde_json::{json, Value};

fn write_state(dir: &Path, profiles: &[(&str, &str)]) {
    std::fs::create_dir_all(dir).unwrap();
    let cache: serde_json::Map<String, Value> = profiles
        .iter()
        .map(|(d, n)| ((*d).to_owned(), json!({ "name": n })))
        .collect();
    let state = json!({ "profile": { "last_used": "Default", "info_cache": cache } });
    std::fs::write(dir.join("Local State"), state.to_string()).unwrap();
}

fn text(r: &CallToolResult) -> String {
    serde_json::to_value(r).unwrap()["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_owned()
}

struct Setup {
    _tmp: tempfile::TempDir,
    server: Server,
    launched: Arc<Mutex<Vec<String>>>,
}

fn two_browsers() -> Setup {
    let tmp = tempfile::tempdir().unwrap();
    let chrome = tmp.path().join("chrome");
    let brave = tmp.path().join("brave");
    write_state(&chrome, &[("Default", "Me")]);
    write_state(&brave, &[("Default", "Brave me"), ("Profile 1", "Other")]);
    let launched = Arc::new(Mutex::new(Vec::new()));
    let log = launched.clone();
    let launch: Launcher = Arc::new(move |id: &str, _: &str| {
        log.lock().unwrap().push(id.to_owned());
        Ok(false)
    });
    let sockets = tmp.path().join("s");
    std::fs::create_dir_all(&sockets).unwrap();
    let opts = ServerOptions {
        store_id: None,
        pace: None,
        config: tmp.path().join("config.toml"),
    };
    let server = Server::with_roots(
        vec![
            Root {
                browser: "chrome",
                dir: chrome,
            },
            Root {
                browser: "brave",
                dir: brave,
            },
        ],
        sockets,
        launch,
        opts,
    );
    Setup {
        _tmp: tmp,
        server,
        launched,
    }
}

#[tokio::test]
async fn list_profiles_prefixes_ids_with_the_browser_when_there_are_two() {
    let s = two_browsers();
    let v: Value = serde_json::from_str(&text(&s.server.list_profiles().await.unwrap())).unwrap();
    let got: Vec<(&str, &str)> = v["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["dir"].as_str().unwrap(), p["browser"].as_str().unwrap()))
        .collect();
    assert_eq!(
        got,
        [
            ("chrome:Default", "chrome"),
            ("brave:Default", "brave"),
            ("brave:Profile 1", "brave")
        ]
    );
}

#[tokio::test]
async fn a_bare_dir_two_browsers_share_is_refused_naming_both() {
    let s = two_browsers();
    let args = serde_json::from_value(json!({ "profile": "Default" })).unwrap();
    let r = s
        .server
        .select_profile(rmcp::handler::server::wrapper::Parameters(args))
        .await
        .unwrap();
    let msg = text(&r);
    assert!(
        msg.contains("chrome:Default") && msg.contains("brave:Default"),
        "{msg}"
    );
    assert!(s.launched.lock().unwrap().is_empty());
}
