// Every installed browser gets the host manifest (plans/14, decision 2).

use std::path::Path;

use browser_hand::install::{self, Options};
use browser_hand::profiles::{self, Os, Root};

const EXE: &str = "/opt/bh";

fn dev_only() -> Options {
    Options {
        no_store: true,
        ..Options::default()
    }
}

#[test]
fn linux_chrome_reads_its_host_manifest_from_dot_config() {
    let chrome = profiles::data_dir(Os::Linux, Path::new("/home/u"), &profiles::BROWSERS[0]);
    assert_eq!(
        install::manifest_path(&chrome),
        Path::new("/home/u/.config/google-chrome/NativeMessagingHosts/dev.browserhand.host.json")
    );
}

#[test]
fn install_writes_a_manifest_in_every_browser_and_names_each_when_there_are_several() {
    let home = tempfile::tempdir().unwrap();
    let chrome = home.path().join("chrome");
    let brave = home.path().join("brave");
    let roots = [
        Root {
            browser: "chrome",
            dir: chrome.clone(),
        },
        Root {
            browser: "brave",
            dir: brave.clone(),
        },
    ];
    let mut out = Vec::new();
    install::run_all(&roots, Path::new(EXE), &dev_only(), None, &mut out).unwrap();
    let out = String::from_utf8(out).unwrap();
    assert!(install::manifest_path(&chrome).is_file());
    assert!(install::manifest_path(&brave).is_file());
    assert!(out.contains("Brave:"), "{out}");
    assert!(out.contains("Google Chrome:"), "{out}");

    // One browser: no header.
    let mut one = Vec::new();
    install::run_all(&roots[..1], Path::new(EXE), &dev_only(), None, &mut one).unwrap();
    assert!(!String::from_utf8(one).unwrap().contains("Google Chrome:"));

    // Uninstall removes from each.
    let gone = Options {
        uninstall: true,
        ..Options::default()
    };
    install::run_all(&roots, Path::new(EXE), &gone, None, &mut Vec::new()).unwrap();
    assert!(!install::manifest_path(&chrome).exists());
    assert!(!install::manifest_path(&brave).exists());
}
