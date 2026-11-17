#![cfg(unix)]
use std::collections::HashSet;
use std::time::Duration;

use browser_hand::reload::{ask, report};
use browser_hand::wire::{self, Frame};
use tokio::net::UnixListener;

#[test]
fn the_report_says_which_profiles_came_back_and_tells_the_others_what_to_do() {
    let asked = vec!["Default".to_string(), "Profile 3".to_string()];
    let back: HashSet<String> = ["Default".to_string()].into();
    let lines = report(&asked, &back, Duration::from_secs(15));
    assert_eq!(lines[0], "Default: reloaded");
    assert!(lines[1].starts_with("Profile 3: asked to reload, not back within 15 s"));
    assert!(lines[1].contains("chrome://extensions"));
}

#[tokio::test]
async fn ask_sends_one_reload_frame_and_fails_when_nobody_listens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("1.sock");
    let listener = UnixListener::bind(&path).unwrap();
    let reader = tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        wire::read_frame(&mut s).await.unwrap()
    });
    ask(&path).await.unwrap();
    assert_eq!(reader.await.unwrap(), Some(Frame::Reload {}));

    assert!(ask(&dir.path().join("none.sock")).await.is_err());
}
