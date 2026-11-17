// The Windows rules that need no Windows: paths, registry command lines,
// pipe names, exe candidates (`plans/16-windows.md`).

use std::path::{Path, PathBuf};

use browser_hand::profiles::{self, Os, BROWSERS};
use browser_hand::winos;

fn b(key: &str) -> &'static profiles::Browser {
    profiles::browser(key).unwrap()
}

#[test]
fn data_dirs_under_local_app_data() {
    let local = Path::new(r"C:\Users\u\AppData\Local");
    let got: Vec<String> = BROWSERS
        .iter()
        .map(|br| {
            let p = profiles::data_dir(Os::Windows, local, br);
            assert!(p.starts_with(local), "{p:?}");
            p.strip_prefix(local)
                .unwrap()
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .collect();
    assert_eq!(
        got,
        [
            "Google/Chrome/User Data",
            "Chromium/User Data",
            "Microsoft/Edge/User Data",
            "BraveSoftware/Brave-Browser/User Data",
            "Vivaldi/User Data",
        ]
    );
}

#[test]
fn registry_keys_per_browser() {
    let key = |k| winos::host_key(b(k));
    assert_eq!(
        key("chrome"),
        r"HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.browserhand.host"
    );
    assert_eq!(
        key("edge"),
        r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\dev.browserhand.host"
    );
    assert_eq!(
        key("brave"),
        r"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.browserhand.host"
    );
    assert_eq!(
        key("chromium"),
        r"HKCU\Software\Chromium\NativeMessagingHosts\dev.browserhand.host"
    );
    assert_eq!(
        key("vivaldi"),
        r"HKCU\Software\Vivaldi\NativeMessagingHosts\dev.browserhand.host"
    );
}

#[test]
fn reg_command_lines() {
    let key = winos::host_key(b("chrome"));
    let manifest =
        r"C:\Users\a b\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts\x & y.json";
    // The path is one argument whatever it holds: no shell sees it.
    assert_eq!(
        winos::reg_add_args(&key, manifest),
        ["add", &key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"]
    );
    assert_eq!(winos::reg_delete_args(&key), ["delete", &key, "/f"]);
    assert_eq!(winos::reg_query_args(&key), ["query", &key]);
    assert_eq!(
        winos::reg_exe(Some(r"C:\Windows".into())),
        PathBuf::from(r"C:\Windows")
            .join("System32")
            .join("reg.exe")
    );
    // No SystemRoot: the default, never a PATH lookup.
    assert_eq!(
        winos::reg_exe(None),
        PathBuf::from(r"C:\Windows")
            .join("System32")
            .join("reg.exe")
    );
}

#[test]
fn verbatim_prefix_is_stripped() {
    let s = |p: &str| winos::strip_verbatim(Path::new(p));
    assert_eq!(
        s(r"\\?\C:\Program Files\bh\browser-hand.exe"),
        PathBuf::from(r"C:\Program Files\bh\browser-hand.exe")
    );
    assert_eq!(
        s(r"\\?\UNC\srv\share\bh.exe"),
        PathBuf::from(r"\\srv\share\bh.exe")
    );
    assert_eq!(s(r"C:\plain\bh.exe"), PathBuf::from(r"C:\plain\bh.exe"));
    assert_eq!(s("/usr/bin/bh"), PathBuf::from("/usr/bin/bh"));
}

#[test]
fn pipe_names_and_listing() {
    let root = Path::new(r"\\.\pipe\");
    let scope = winos::pipe_scope(root);
    assert_eq!(scope, "bh");
    assert_eq!(winos::pipe_name(&scope, 42), r"\\.\pipe\browser-hand-bh-42");
    // The same name with or without the trailing separator.
    assert_eq!(winos::pipe_scope(Path::new(r"\\.\pipe")), "bh");

    // A test directory gets its own scope: stable, plain, distinct.
    let t1 = winos::pipe_scope(Path::new("/tmp/a b/../sockets"));
    let t2 = winos::pipe_scope(Path::new("/tmp/other"));
    assert_ne!(t1, t2);
    assert_eq!(t1, winos::pipe_scope(Path::new("/tmp/a b/../sockets")));
    assert!(
        t1.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "{t1}"
    );
    assert!(t1.len() <= 48, "{t1}");

    assert!(winos::is_host_pipe("browser-hand-bh-42", "bh"));
    assert!(!winos::is_host_pipe("browser-hand-bh-42x", "bh"));
    assert!(!winos::is_host_pipe("browser-hand-bh-", "bh"));
    assert!(!winos::is_host_pipe("browser-hand-other-42", "bh"));
    assert!(!winos::is_host_pipe("mojo.1234.5678", "bh"));
    // A scope that is a prefix of another does not match it.
    assert!(!winos::is_host_pipe("browser-hand-bh2-7", "bh"));
}

#[test]
fn sddl_grants_one_sid() {
    let sid = "S-1-5-21-1004336348-1177238915-682003330-1000";
    assert_eq!(
        winos::pipe_sddl(sid).unwrap(),
        format!("D:P(A;;GA;;;{sid})")
    );
    // Anything that is not a SID is refused: it would be spliced into SDDL.
    for bad in [
        "",
        "Everyone",
        "S-1-5-18)(A;;GA;;;WD",
        "S-1-5-21 x",
        "s-1-5-1",
    ] {
        assert!(winos::pipe_sddl(bad).is_err(), "{bad}");
    }
}

#[test]
fn exe_candidates_in_three_folders() {
    let env = winos::WinEnv {
        program_files: Some(r"C:\Program Files".into()),
        program_files_x86: Some(r"C:\Program Files (x86)".into()),
        local_app_data: Some(r"C:\Users\u\AppData\Local".into()),
    };
    let c = winos::exe_candidates(&env, b("chrome"));
    assert_eq!(
        c,
        [
            PathBuf::from(r"C:\Program Files")
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
            PathBuf::from(r"C:\Program Files (x86)")
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
            PathBuf::from(r"C:\Users\u\AppData\Local")
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
        ]
    );
    for (key, exe) in [
        ("edge", "msedge.exe"),
        ("brave", "brave.exe"),
        ("vivaldi", "vivaldi.exe"),
        ("chromium", "chrome.exe"),
    ] {
        let c = winos::exe_candidates(&env, b(key));
        assert_eq!(c.len(), 3);
        assert!(
            c[0].ends_with(Path::new("Application").join(exe)),
            "{key}: {:?}",
            c[0]
        );
    }
    // A missing variable gives no candidate for it.
    let none = winos::WinEnv {
        program_files: None,
        program_files_x86: None,
        local_app_data: None,
    };
    assert!(winos::exe_candidates(&none, b("chrome")).is_empty());
}

#[test]
fn filetime_and_local_text() {
    assert_eq!(winos::ms_to_filetime(0), 116_444_736_000_000_000);
    assert_eq!(winos::ms_to_filetime(1_000), 116_444_736_010_000_000);
    assert_eq!(winos::local_text(2026, 11, 7, 9, 5), "2026-11-07 09:05");
}

#[test]
fn config_path_per_system() {
    let home = PathBuf::from("/home/u");
    let local = Some(PathBuf::from(r"C:\Users\u\AppData\Local"));
    // Unix: XDG when absolute, else ~/.config.
    assert_eq!(
        browser_hand::paths::config_path_in(false, Some("/x/cfg".into()), &home, None),
        PathBuf::from("/x/cfg/browser-hand/config.toml")
    );
    assert_eq!(
        browser_hand::paths::config_path_in(false, Some("rel".into()), &home, None),
        PathBuf::from("/home/u/.config/browser-hand/config.toml")
    );
    // Windows: %LOCALAPPDATA%, XDG ignored.
    assert_eq!(
        browser_hand::paths::config_path_in(true, Some("/x/cfg".into()), &home, local),
        PathBuf::from(r"C:\Users\u\AppData\Local")
            .join("browser-hand")
            .join("config.toml")
    );
    // Windows with no LOCALAPPDATA: under the home.
    assert_eq!(
        browser_hand::paths::config_path_in(true, None, &home, None),
        PathBuf::from("/home/u/AppData/Local/browser-hand/config.toml")
    );
}

#[test]
fn ntfs_streams_are_spotted() {
    for bad in [
        r"C:\Users\u\secret.pem:x",
        r"C:\Users\u\a.txt::$DATA",
        r"\\?\C:\Users\u\a.txt:s",
        r"D:rel.txt:s",
    ] {
        assert!(winos::has_stream(bad), "{bad}");
    }
    for ok in [
        r"C:\Users\u\a.txt",
        r"\\?\C:\a.txt",
        r"\\srv\share\a.txt",
        "/home/u/a.txt",
    ] {
        assert!(!winos::has_stream(ok), "{ok}");
    }
}

#[test]
fn identify_reads_windows_exe_paths() {
    let none: &[profiles::Root] = &[];
    let id = |p: &str| profiles::identify(Some(Path::new(p)), None, none);
    assert_eq!(
        id(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Some("chrome")
    );
    assert_eq!(
        id(r"C:\Program Files\Chromium\Application\chrome.exe"),
        Some("chromium")
    );
    assert_eq!(
        id(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Some("edge")
    );
    assert_eq!(
        id(r"C:\Users\u\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe"),
        Some("brave")
    );
    assert_eq!(
        id(r"C:\Users\u\AppData\Local\Vivaldi\Application\vivaldi.exe"),
        Some("vivaldi")
    );
    // A home folder named for a browser never counts.
    assert_eq!(id(r"C:\Users\brave\Tools\app.exe"), None);
    assert_eq!(id(r"C:\Users\brave\Application\app.exe"), None);
    // A user data dir written with a trailing backslash still matches a root.
    let roots = [profiles::Root {
        browser: "edge",
        dir: PathBuf::from(r"C:\d\Edge"),
    }];
    assert_eq!(
        profiles::identify(None, Some(Path::new(r"C:\d\Edge\")), &roots),
        Some("edge")
    );
}
