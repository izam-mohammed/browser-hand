use std::cell::Cell;
use std::time::Duration;

use browser_hand::host_conn::{call_error_frame, CallError};
use browser_hand::mcp::{wait_for, RECONNECT_WAIT};
use browser_hand::wire::Frame;

/// The wait polls every 250 ms for up to 6 s, on the clock tokio is told to
/// fake, so the tests take no real time.
#[tokio::test(start_paused = true)]
async fn waits_for_a_host_that_comes_back_and_goes_on() {
    let polls = Cell::new(0);
    let found = wait_for(RECONNECT_WAIT, Duration::from_millis(250), || async {
        polls.set(polls.get() + 1);
        (polls.get() == 5).then_some("host")
    })
    .await;
    assert_eq!(found, Some("host"));
    assert_eq!(polls.get(), 5);
}

#[tokio::test(start_paused = true)]
async fn gives_up_after_six_seconds() {
    assert_eq!(RECONNECT_WAIT, Duration::from_secs(6));
    let started = tokio::time::Instant::now();
    let found: Option<()> = wait_for(RECONNECT_WAIT, Duration::from_millis(250), || async {
        None
    })
    .await;
    assert_eq!(found, None);
    let took = started.elapsed();
    assert!(took >= Duration::from_secs(6), "{took:?}");
    assert!(took < Duration::from_millis(6300), "{took:?}");
}

#[tokio::test(start_paused = true)]
async fn finds_a_host_that_is_already_there_without_waiting() {
    let started = tokio::time::Instant::now();
    let found = wait_for(RECONNECT_WAIT, Duration::from_millis(250), || async {
        Some(1)
    })
    .await;
    assert_eq!(found, Some(1));
    assert_eq!(started.elapsed(), Duration::ZERO);
}

fn message(f: Frame) -> String {
    match f {
        Frame::Result { error: Some(e), .. } => e.message,
        other => panic!("not an error: {other:?}"),
    }
}

#[test]
fn a_call_cut_off_mid_way_says_it_may_have_run() {
    let m = message(call_error_frame(
        CallError::CutOff,
        "computer",
        Duration::from_secs(20),
    ));
    assert!(m.contains("may have run"), "{m}");
    assert!(m.contains("computer"), "{m}");
    assert!(m.contains("before repeating"), "{m}");
}

#[test]
fn a_call_that_never_left_says_nothing_ran() {
    let m = message(call_error_frame(
        CallError::Disconnected,
        "computer",
        Duration::from_secs(20),
    ));
    assert!(!m.contains("may have run"), "{m}");
}
