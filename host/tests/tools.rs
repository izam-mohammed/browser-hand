// The server-side helpers behind `file_upload` and the kept screenshots.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use browser_hand::tools::files::{self, MAX_UPLOAD_BYTES};
use browser_hand::tools::images::{self, ImageStore};

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn mime_types_follow_the_extension_in_any_case_and_default_to_bytes() {
    for (name, mime) in [
        ("a.PNG", "image/png"),
        ("a.jpeg", "image/jpeg"),
        ("a.jpg", "image/jpeg"),
        ("a.gif", "image/gif"),
        ("a.webp", "image/webp"),
        ("a.svg", "image/svg+xml"),
        ("a.pdf", "application/pdf"),
        ("a.txt", "text/plain"),
        ("a.csv", "text/csv"),
        ("a.json", "application/json"),
        ("a.htm", "text/html"),
        ("a.zip", "application/zip"),
        ("a.doc", "application/msword"),
        ("a.mp4", "video/mp4"),
        ("a.mp3", "audio/mpeg"),
        ("a.unknown", "application/octet-stream"),
        ("noext", "application/octet-stream"),
    ] {
        assert_eq!(files::mime_for(Path::new(name)), mime, "{name}");
    }
    assert!(files::mime_for(Path::new("a.docx")).contains("wordprocessingml"));
    assert!(files::mime_for(Path::new("a.xlsx")).contains("spreadsheetml"));
}

#[test]
fn upload_reads_each_file_as_name_mime_and_base64() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("note.txt");
    std::fs::write(&a, b"hello").unwrap();
    let got = files::read_for_upload(&[s(&a)]).unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0]["name"], "note.txt");
    assert_eq!(got[0]["mimeType"], "text/plain");
    assert_eq!(got[0]["data"], "aGVsbG8=");
}

#[test]
fn upload_refuses_no_paths_relative_paths_missing_files_and_directories() {
    let dir = tempfile::tempdir().unwrap();
    assert!(files::read_for_upload(&[])
        .unwrap_err()
        .contains("paths is empty"));
    assert!(files::read_for_upload(&["rel/a.txt".into()])
        .unwrap_err()
        .contains("not an absolute path"));
    let missing = s(&dir.path().join("missing.txt"));
    assert!(files::read_for_upload(&[missing])
        .unwrap_err()
        .starts_with("bad_args:"));
    assert!(files::read_for_upload(&[s(dir.path())])
        .unwrap_err()
        .contains("is not a file"));
}

#[test]
fn upload_refuses_files_that_add_up_to_more_than_the_limit() {
    let dir = tempfile::tempdir().unwrap();
    let big = dir.path().join("big.bin");
    let f = std::fs::File::create(&big).unwrap();
    f.set_len(MAX_UPLOAD_BYTES + 1).unwrap();
    let e = files::read_for_upload(&[s(&big)]).unwrap_err();
    assert!(e.contains("10 MB"), "{e}");
}

fn write(dir: &Path, rel: &str) -> String {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, b"secret").unwrap();
    s(&p)
}

fn refused(path: &str) -> String {
    let e = files::read_for_upload(&[path.to_string()]).unwrap_err();
    assert!(e.starts_with("refused:"), "{e}");
    assert!(e.contains("ask the person for another file"), "{e}");
    e
}

#[test]
fn upload_refuses_env_pem_and_key_files_in_any_case() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
        ".env",
        ".ENV",
        ".env.local",
        ".env.production",
        "server.pem",
        "SERVER.PEM",
        "id.key",
        "x.KEY",
    ] {
        let e = refused(&write(dir.path(), name));
        assert!(e.contains(name), "{e}");
    }
    assert!(refused(&write(dir.path(), ".env")).contains("holds secrets"));
}

#[test]
fn upload_refuses_anything_inside_a_ssh_folder() {
    let dir = tempfile::tempdir().unwrap();
    for rel in [
        ".ssh/id_ed25519",
        ".ssh/config",
        "a/.SSH/known_hosts",
        ".ssh/deep/x.txt",
    ] {
        let e = refused(&write(dir.path(), rel));
        assert!(e.contains(".ssh"), "{e}");
    }
}

#[cfg(unix)]
#[test]
fn upload_refuses_a_symlink_to_a_protected_file_under_a_harmless_name() {
    let dir = tempfile::tempdir().unwrap();
    let target = write(dir.path(), ".ssh/id_ed25519");
    let link = dir.path().join("holiday.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let e = refused(&s(&link));
    assert!(e.contains("symlink") || e.contains(".ssh"), "{e}");
    let env = write(dir.path(), "real/.env");
    let link2 = dir.path().join("notes.png");
    std::os::unix::fs::symlink(&env, &link2).unwrap();
    refused(&s(&link2));
}

#[test]
fn upload_refuses_a_hard_link_and_says_why() {
    let dir = tempfile::tempdir().unwrap();
    let orig = write(dir.path(), "secret.txt");
    let link = dir.path().join("harmless.txt");
    std::fs::hard_link(&orig, &link).unwrap();
    for p in [&orig, &s(&link)] {
        let e = refused(p);
        assert!(e.contains("hard link"), "{e}");
    }
}

#[cfg(unix)]
#[test]
fn upload_still_takes_normal_files_and_lookalike_names() {
    let dir = tempfile::tempdir().unwrap();
    for rel in [
        "config.env.example",
        "environment.txt",
        "monkey.png",
        "keys.txt",
        "pem.txt",
        "ssh/readme.txt",
        "my.ssh.txt",
        "photo.png",
    ] {
        let p = write(dir.path(), rel);
        assert!(files::read_for_upload(&[p]).is_ok(), "{rel}");
    }
    // A symlink to a normal file is fine.
    let t = write(dir.path(), "plain.txt");
    let l = dir.path().join("alias.txt");
    std::os::unix::fs::symlink(&t, &l).unwrap();
    assert!(files::read_for_upload(&[s(&l)]).is_ok());
}

#[test]
fn a_kept_image_is_found_by_its_id_and_ids_do_not_repeat() {
    let mut store = ImageStore::default();
    let a = store.keep("AAAA".into(), "image/png".into());
    let b = store.keep("BBBB".into(), "image/jpeg".into());
    assert_ne!(a, b);
    let kept = store.get(&a).unwrap();
    assert_eq!(kept.data, "AAAA");
    assert_eq!(kept.mime_type, "image/png");
    assert!(store.get("img_999").is_none());
    assert!(images::IMAGE_TTL >= Duration::from_secs(60));
}

#[test]
fn save_writes_png_or_jpg_into_the_output_folder_and_refuses_bad_base64() {
    let dir = tempfile::tempdir().unwrap();
    // The output dir comes from the environment; this file's tests share it,
    // and only this test sets it.
    std::env::set_var("BROWSER_HAND_OUTPUT_DIR", dir.path());
    let data = base64::engine::general_purpose::STANDARD.encode(b"pixels");

    let png = images::save(&data, "image/png", "shot", "~/unused").unwrap();
    assert!(png.extension().is_some_and(|e| e == "png"));
    assert_eq!(std::fs::read(&png).unwrap(), b"pixels");
    assert!(png.starts_with(dir.path()));

    let jpg = images::save(&data, "image/jpeg", "shot", "~/unused").unwrap();
    assert!(jpg.extension().is_some_and(|e| e == "jpg"));

    let e = images::save("!!not base64!!", "image/png", "shot", "~/unused").unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::InvalidData);
}

#[test]
fn the_scale_is_image_pixels_per_viewport_pixel() {
    let text = "Successfully captured screenshot (viewport 1000x800, image 500x400, jpeg)";
    assert_eq!(images::scale_from_text(text), Some(0.5));
    assert_eq!(images::scale_from_text("no sizes here"), None);
    assert_eq!(
        images::scale_from_text("viewport 0x800 image 10x10"),
        None,
        "a zero-width viewport has no scale"
    );
    assert_eq!(images::scale_from_text("viewport 10x10 image"), None);
}
