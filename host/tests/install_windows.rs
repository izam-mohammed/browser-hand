// The Windows install writes the manifest in the browser's folder and points
// the browser's registry key at it. `reg.exe` is a recording stand-in here
// (`plans/16-windows.md`, decision 3).

use std::cell::RefCell;
use std::path::Path;

use browser_hand::install::{self, Options};
use browser_hand::profiles::Root;

const EXE: &str = r"\\?\C:\Program Files\bh\browser-hand.exe";

fn windows(uninstall: bool) -> Options {
    Options {
        windows: true,
        no_store: true,
        uninstall,
        ..Options::default()
    }
}

fn roots(base: &Path) -> Vec<Root> {
    vec![
        Root {
            browser: "chrome",
            dir: base.join("chrome"),
        },
        Root {
            browser: "edge",
            dir: base.join("edge"),
        },
    ]
}

#[test]
fn install_registers_each_browsers_key_at_its_manifest() {
    let base = tempfile::tempdir().unwrap();
    let roots = roots(base.path());
    let calls = RefCell::new(Vec::<Vec<String>>::new());
    let reg = |a: &[String]| {
        calls.borrow_mut().push(a.to_vec());
        Ok(true)
    };
    let mut out = Vec::new();
    install::run_all_with(
        &roots,
        Path::new(EXE),
        &windows(false),
        None,
        &reg,
        &mut out,
    )
    .unwrap();
    let out = String::from_utf8(out).unwrap();

    let calls = calls.into_inner();
    assert_eq!(calls.len(), 2);
    for (call, r) in calls.iter().zip(&roots) {
        let manifest = install::manifest_path(&r.dir);
        assert!(manifest.is_file());
        assert_eq!(call[0], "add");
        assert!(call[1].starts_with(r"HKCU\Software\"), "{call:?}");
        assert!(call[1].ends_with(r"\NativeMessagingHosts\dev.browserhand.host"));
        assert_eq!(call[6], manifest.to_string_lossy());
        assert_eq!(&call[2..6], ["/ve", "/t", "REG_SZ", "/d"]);
    }
    assert!(calls[1][1].contains(r"Microsoft\Edge"), "{:?}", calls[1]);
    assert!(out.contains("Registered HKCU"), "{out}");
    // No External Extensions file on Windows.
    assert!(!roots[0].dir.join("External Extensions").exists());
}

#[test]
fn a_failed_reg_says_the_key_and_value_to_set_by_hand() {
    let base = tempfile::tempdir().unwrap();
    let roots = roots(base.path());
    let reg = |_: &[String]| Ok(false);
    let e = install::run_all_with(
        &roots[..1],
        Path::new(EXE),
        &windows(false),
        None,
        &reg,
        &mut Vec::new(),
    )
    .unwrap_err()
    .to_string();
    assert!(
        e.contains(r"HKCU\Software\Google\Chrome\NativeMessagingHosts"),
        "{e}"
    );
    assert!(e.contains("regedit"), "{e}");
}

#[test]
fn uninstall_deletes_a_key_that_exists_and_says_nothing_to_remove_otherwise() {
    let base = tempfile::tempdir().unwrap();
    let roots = roots(base.path());
    let calls = RefCell::new(Vec::<String>::new());
    // The key exists for Chrome only: `query` succeeds for it.
    let reg = |a: &[String]| {
        calls.borrow_mut().push(a[0].clone());
        Ok(a[0] != "query" || a[1].contains("Google"))
    };
    let mut out = Vec::new();
    install::run_all_with(&roots, Path::new(EXE), &windows(true), None, &reg, &mut out).unwrap();
    let out = String::from_utf8(out).unwrap();
    assert_eq!(calls.into_inner(), ["query", "delete", "query"]);
    assert!(out.contains("Removed HKCU"), "{out}");
    assert!(out.contains("Nothing to remove at HKCU"), "{out}");
}

#[test]
fn the_verbatim_prefix_never_reaches_the_manifest() {
    let base = tempfile::tempdir().unwrap();
    let roots = roots(base.path());
    let exe = browser_hand::winos::strip_verbatim(Path::new(EXE));
    install::run_all_with(
        &roots[..1],
        &exe,
        &windows(false),
        None,
        &|_: &[String]| Ok(true),
        &mut Vec::new(),
    )
    .unwrap();
    let text = std::fs::read_to_string(install::manifest_path(&roots[0].dir)).unwrap();
    assert!(!text.contains(r"\\\\?\\"), "{text}");
    assert!(
        text.contains(r"C:\\Program Files\\bh\\browser-hand.exe"),
        "{text}"
    );
}

#[test]
fn mobileconfig_is_refused_on_windows_and_the_store_file_is_not_written() {
    let base = tempfile::tempdir().unwrap();
    let dir = base.path().join("chrome");
    let o = Options {
        mobileconfig: Some(base.path().join("x.mobileconfig")),
        no_store: false,
        ..windows(false)
    };
    let e = install::run(
        &dir,
        Path::new("C:\\bh.exe"),
        &o,
        Some("abc"),
        &mut Vec::new(),
    )
    .unwrap_err()
    .to_string();
    assert!(e.contains("macOS"), "{e}");

    let o = Options {
        no_store: false,
        ..windows(false)
    };
    let mut out = Vec::new();
    install::run(&dir, Path::new("C:\\bh.exe"), &o, Some("abc"), &mut out).unwrap();
    assert!(!dir.join("External Extensions").exists());
    assert!(String::from_utf8(out)
        .unwrap()
        .contains("no External Extensions"));
}
