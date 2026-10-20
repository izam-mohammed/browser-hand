// Prove rmcp 3.5.1 serves one tool over stdio that returns text and an image,
// per docs/external/rmcp.md. No project code.
use rmcp::{
    model::{CallToolResult, ContentBlock},
    tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt,
    transport::stdio,
};

// A 1x1 transparent PNG, base64.
const PIXEL_PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

#[derive(Clone)]
struct Prove;

#[tool_router]
impl Prove {
    #[tool(description = "Returns a line of text and a 1x1 PNG")]
    async fn screenshot(&self) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![
            ContentBlock::text("one pixel"),
            ContentBlock::image(PIXEL_PNG, "image/png"),
        ]))
    }
}

#[tool_handler(instructions = "Proof server for browser-hand")]
impl ServerHandler for Prove {}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let service = Prove.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
