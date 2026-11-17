use browser_hand::tools::args::{
    BatchArgs, ComputerArgs, FileUploadArgs, RecordingReplayArgs, UploadImageArgs,
};
use serde_json::{json, Value};

fn err<T: serde::de::DeserializeOwned + std::fmt::Debug>(v: Value) -> String {
    serde_json::from_value::<T>(v)
        .expect_err("should be refused")
        .to_string()
}

#[test]
fn a_coordinate_sent_as_json_text_is_refused_with_the_shape_to_send() {
    let m = err::<ComputerArgs>(
        json!({"action": "left_click", "tabId": 1, "coordinate": "[300, 200]"}),
    );
    assert!(m.contains("coordinate"), "{m}");
    assert!(m.contains("[300, 200]") || m.contains("[x, y]"), "{m}");
    assert!(m.contains("not as text"), "{m}");
}

#[test]
fn start_coordinate_and_region_are_checked_too() {
    let m = err::<ComputerArgs>(
        json!({"action": "left_click_drag", "tabId": 1, "start_coordinate": "[1,2]", "coordinate": [3, 4]}),
    );
    assert!(m.contains("start_coordinate"), "{m}");
    let m =
        err::<ComputerArgs>(json!({"action": "zoom", "tabId": 1, "region": "[0, 0, 100, 100]"}));
    assert!(m.contains("region"), "{m}");
    assert!(m.contains("[x0, y0, x1, y1]"), "{m}");
}

#[test]
fn batch_actions_sent_as_json_text_are_refused() {
    let m = err::<BatchArgs>(json!({"actions": "[{\"name\": \"find\", \"input\": {}}]"}));
    assert!(m.contains("actions"), "{m}");
    assert!(m.contains("not as text"), "{m}");
}

#[test]
fn other_array_and_object_fields_are_checked() {
    assert!(
        err::<FileUploadArgs>(json!({"paths": "[\"/a\"]", "ref": "r", "tabId": 1}))
            .contains("paths")
    );
    assert!(err::<RecordingReplayArgs>(json!({"values": "{\"4\": \"x\"}"})).contains("values"));
    assert!(
        err::<UploadImageArgs>(json!({"imageId": "i", "tabId": 1, "coordinate": "[1, 2]"}))
            .contains("coordinate")
    );
}

#[test]
fn text_that_is_not_json_is_still_refused_without_being_coerced() {
    let m =
        err::<ComputerArgs>(json!({"action": "left_click", "tabId": 1, "coordinate": "300,200"}));
    assert!(m.contains("coordinate"), "{m}");
}

#[test]
fn real_arrays_and_nulls_pass() {
    let a: ComputerArgs = serde_json::from_value(
        json!({"action": "left_click", "tabId": 1, "coordinate": [300, 200]}),
    )
    .unwrap();
    assert_eq!(a.coordinate, Some([300.0, 200.0]));
    let a: ComputerArgs =
        serde_json::from_value(json!({"action": "screenshot", "tabId": 1, "coordinate": null}))
            .unwrap();
    assert_eq!(a.coordinate, None);
    let b: BatchArgs = serde_json::from_value(
        json!({"actions": [{"name": "find", "input": {"query": "x", "tabId": 1}}]}),
    )
    .unwrap();
    assert_eq!(b.actions.len(), 1);
}

#[test]
fn a_string_field_that_looks_like_json_is_not_refused() {
    let a: ComputerArgs =
        serde_json::from_value(json!({"action": "type", "tabId": 1, "text": "[300, 200]"}))
            .unwrap();
    assert_eq!(a.text.as_deref(), Some("[300, 200]"));
}
