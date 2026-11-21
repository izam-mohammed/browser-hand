//! The command line's words for `replay` and `recordings`.

use browser_hand::replay_cli::{parse, ReplayOptions};

fn words(s: &str) -> Vec<String> {
    s.split_whitespace().map(String::from).collect()
}

#[test]
fn no_words_means_the_newest_recording_in_the_default_profile() {
    assert_eq!(parse(&[]).unwrap(), ReplayOptions::default());
}

#[test]
fn an_id_a_profile_a_start_step_and_values_are_read() {
    let o = parse(&words(
        "rec_7 --profile Profile3 --from 4 --value 4=new --value 9=hunter=2",
    ))
    .unwrap();
    assert_eq!(o.id.as_deref(), Some("rec_7"));
    assert_eq!(o.profile.as_deref(), Some("Profile3"));
    assert_eq!(o.from, Some(4));
    assert_eq!(o.values["4"], "new");
    assert_eq!(o.values["9"], "hunter=2", "only the first = splits");
}

#[test]
fn a_bad_word_is_refused_with_the_usage() {
    for bad in [
        "--from",
        "--from soon",
        "--value 4",
        "--wat",
        "rec_1 rec_2",
        "--profile",
    ] {
        let e = parse(&words(bad)).unwrap_err().to_string();
        assert!(!e.is_empty(), "{bad}");
    }
    assert!(parse(&words("--from"))
        .unwrap_err()
        .to_string()
        .contains("usage: browser-hand"));
}
