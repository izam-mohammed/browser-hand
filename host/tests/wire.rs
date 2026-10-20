use browser_hand::wire::{self, Frame, Reassembler, CHROME_MAX_MESSAGE};
use serde_json::{json, Value};

fn fixtures() -> Vec<Value> {
    let text = include_str!("fixtures/frames.json");
    serde_json::from_str(text).unwrap()
}

#[test]
fn every_fixture_frame_round_trips_unchanged() {
    for value in fixtures() {
        let frame: Frame = serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("{value} did not parse: {e}"));
        assert_eq!(serde_json::to_value(&frame).unwrap(), value);
    }
}

#[tokio::test]
async fn framing_reads_back_what_it_wrote_and_ends_cleanly() {
    let (mut a, mut b) = tokio::io::duplex(1 << 16);
    let frames: Vec<Frame> = fixtures()
        .into_iter()
        .map(|v| serde_json::from_value(v).unwrap())
        .collect();
    for f in &frames {
        wire::write_frame(&mut a, f).await.unwrap();
    }
    drop(a);
    for f in &frames {
        assert_eq!(wire::read_frame(&mut b).await.unwrap().as_ref(), Some(f));
    }
    assert!(wire::read_frame(&mut b).await.unwrap().is_none());
}

#[tokio::test]
async fn an_unknown_frame_is_invalid_data_and_the_stream_continues() {
    let (mut a, mut b) = tokio::io::duplex(1 << 16);
    wire::write_body(&mut a, br#"{"type":"nope"}"#)
        .await
        .unwrap();
    wire::write_frame(
        &mut a,
        &Frame::End {
            session: "s".into(),
        },
    )
    .await
    .unwrap();
    let err = wire::read_frame(&mut b).await.unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    assert!(matches!(
        wire::read_frame(&mut b).await.unwrap(),
        Some(Frame::End { .. })
    ));
}

fn big_call(bytes: usize) -> Frame {
    Frame::Call {
        id: 42,
        session: "s".into(),
        tool: "upload_image".into(),
        args: json!({ "data": "x".repeat(bytes) }),
    }
}

#[test]
fn a_frame_under_the_chrome_limit_is_not_chunked() {
    let frame = big_call(1000);
    assert_eq!(wire::chunk(&frame), vec![frame]);
}

#[test]
fn a_frame_over_the_chrome_limit_splits_into_chunks_that_each_fit_and_rejoin() {
    let frame = big_call(2_500_000);
    let chunks = wire::chunk(&frame);
    assert!(chunks.len() > 1);
    for c in &chunks {
        assert!(matches!(c, Frame::Chunk { id: 42, .. }));
        assert!(wire::to_json(c).len() <= CHROME_MAX_MESSAGE);
    }
    let mut r = Reassembler::default();
    let mut out = None;
    for c in chunks {
        out = r.push(c).unwrap();
    }
    assert_eq!(out, Some(frame));
}

#[test]
fn the_boundary_is_exactly_the_chrome_limit() {
    // Find a payload whose JSON body is exactly CHROME_MAX_MESSAGE bytes.
    let overhead = wire::to_json(&big_call(0)).len();
    let at_limit = big_call(CHROME_MAX_MESSAGE - overhead);
    assert_eq!(wire::to_json(&at_limit).len(), CHROME_MAX_MESSAGE);
    assert_eq!(wire::chunk(&at_limit).len(), 1);
    assert!(wire::chunk(&big_call(CHROME_MAX_MESSAGE - overhead + 1)).len() > 1);
}

#[test]
fn chunks_out_of_order_are_refused() {
    let mut chunks = wire::chunk(&big_call(2_500_000));
    chunks.swap(0, 1);
    let mut r = Reassembler::default();
    assert!(r.push(chunks.remove(0)).is_err());
}

/// Writes the chunks of a fixed large call for the extension's tests to
/// rejoin (`extension/test/wire.test.ts`).
#[test]
fn writes_the_chunked_fixture_for_the_extension() {
    let chunks = wire::chunk(&big_call(1_200_000));
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/chunked-call.json"
    );
    std::fs::write(path, serde_json::to_vec(&chunks).unwrap()).unwrap();
}
