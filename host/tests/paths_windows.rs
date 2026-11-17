// Windows spellings of the GIF folder, checked on any system
// (`plans/16-windows.md`, phase 2).

use std::path::{Path, PathBuf};

use browser_hand::config::{expand_in, folder_problem_in};

#[test]
fn tilde_expands_with_either_slash_on_windows_only() {
    let home = Path::new(r"C:\Users\u");
    assert_eq!(expand_in("~", home, true), home);
    assert_eq!(
        expand_in("~/Downloads/browser-hand", home, true),
        home.join("Downloads/browser-hand")
    );
    assert_eq!(
        expand_in(r"~\Downloads\browser-hand", home, true),
        home.join(r"Downloads\browser-hand")
    );
    // On Unix a backslash is part of a name: `~\x` is not under the home.
    assert_eq!(
        expand_in(r"~\x", Path::new("/home/u"), false),
        PathBuf::from(r"~\x")
    );
    assert_eq!(expand_in("~user/x", home, true), PathBuf::from("~user/x"));
}

#[test]
fn windows_folders_start_at_a_drive_a_share_or_the_home() {
    for ok in [
        r"C:\Users\u\Videos",
        "D:/gifs",
        r"\\srv\share\gifs",
        r"~\gifs",
        "~/gifs",
        "~",
    ] {
        assert_eq!(folder_problem_in(ok, true), None, "{ok}");
    }
    for bad in [r"gifs\x", "C:gifs", r"C:\a\..\b", r"~\a\..\b", ""] {
        assert!(folder_problem_in(bad, true).is_some(), "{bad}");
    }
    let m = folder_problem_in("rel", true).unwrap();
    assert!(m.contains("C:"), "{m}");
    // The same drive path is not a folder on Unix.
    assert!(folder_problem_in(r"C:\Users\u", false).is_some());
    assert_eq!(folder_problem_in("/tmp/x", false), None);
}
