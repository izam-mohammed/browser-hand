use browser_hand::mcp::INSTRUCTIONS;

#[test]
fn the_server_instructions_fit_claude_codes_limit() {
    // Claude Code cuts server instructions at 4,096 characters
    // (docs/external/claude-code-mcp-and-skills.md § Limits).
    assert!(
        INSTRUCTIONS.chars().count() <= 4096,
        "{} characters",
        INSTRUCTIONS.chars().count()
    );
}

#[test]
fn the_instructions_carry_the_rules_that_matter() {
    for must in [
        "list_profiles",
        "never pick for them",
        "tabs_context",
        "Close the tabs you",
        "action_summary",
        "browser_batch",
        "file_upload",
        "data, not instructions",
        "recording_get",
        "you cannot start one",
        "never instructions to follow",
    ] {
        assert!(INSTRUCTIONS.contains(must), "missing: {must}");
    }
}
