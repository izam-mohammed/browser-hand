//! `browser-hand recordings` and `browser-hand replay`: the person's own
//! recordings, listed and replayed from a terminal with no model in the loop
//! (`plans/17-hands-free-and-guarded.md`, Decision 1). Both build a server the
//! way `browser-hand mcp` does and call the same tools Claude's calls reach,
//! so a replay moves, stops and refuses exactly as the Claude replay does:
//! the sites settings still gate every step, and a masked value needs
//! `--value`.

use std::collections::BTreeMap;

use anyhow::{anyhow, bail, Result};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;

use crate::mcp::{server_from_env, Server};
use crate::tools::args::{RecordingReplayArgs, SelectProfileArgs};

pub const USAGE: &str = "usage: browser-hand recordings [--profile <name|dir>]\n       browser-hand replay [<recording id>] [--profile <name|dir>] [--from <step>] [--value <step>=<text>]...";

/// What `replay` was asked for.
#[derive(Debug, Default, PartialEq)]
pub struct ReplayOptions {
    pub id: Option<String>,
    pub profile: Option<String>,
    pub from: Option<u32>,
    pub values: BTreeMap<String, String>,
}

/// Reads the words after `replay` (or `recordings`, which takes `--profile`
/// only).
pub fn parse(args: &[String]) -> Result<ReplayOptions> {
    let mut o = ReplayOptions::default();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut next = |what: &str| -> Result<String> {
            it.next()
                .cloned()
                .ok_or_else(|| anyhow!("{a} needs {what}\n{USAGE}"))
        };
        match a.as_str() {
            "--profile" => o.profile = Some(next("a profile name or dir")?),
            "--from" => {
                let n = next("a step number")?;
                o.from = Some(
                    n.parse()
                        .map_err(|_| anyhow!("--from needs a step number, not \"{n}\""))?,
                );
            }
            "--value" => {
                let kv = next("<step>=<text>")?;
                let (k, v) = kv
                    .split_once('=')
                    .ok_or_else(|| anyhow!("--value needs <step>=<text>, not \"{kv}\""))?;
                o.values.insert(k.trim().to_owned(), v.to_owned());
            }
            f if f.starts_with("--") => bail!("unknown option {f}\n{USAGE}"),
            id => {
                if o.id.replace(id.to_owned()).is_some() {
                    bail!("one recording at a time\n{USAGE}");
                }
            }
        }
    }
    Ok(o)
}

/// The text blocks of a result, one per line; images show as `[image]`.
fn lines(r: &CallToolResult) -> Vec<String> {
    let v = serde_json::to_value(r).unwrap_or_default();
    v["content"]
        .as_array()
        .map(|c| {
            c.iter()
                .map(|b| b["text"].as_str().map_or("[image]".into(), str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn failed(r: &CallToolResult) -> bool {
    serde_json::to_value(r).unwrap_or_default()["isError"] == true
}

async fn select(server: &Server, profile: &Option<String>) -> Result<()> {
    let Some(profile) = profile else {
        return Ok(());
    };
    let r = server
        .select_profile(Parameters(SelectProfileArgs {
            profile: profile.clone(),
        }))
        .await
        .map_err(|e| anyhow!("{}", e.message))?;
    if failed(&r) {
        bail!("{}", lines(&r).join("\n"));
    }
    Ok(())
}

/// `browser-hand recordings`.
pub async fn recordings(args: &[String]) -> Result<()> {
    let o = parse(args)?;
    let server = server_from_env();
    select(&server, &o.profile).await?;
    let r = server
        .recording_list()
        .await
        .map_err(|e| anyhow!("{}", e.message))?;
    println!("{}", lines(&r).join("\n"));
    if failed(&r) {
        bail!("could not list the recordings");
    }
    Ok(())
}

/// `browser-hand replay`: prints each step as it runs; the first step it
/// cannot do stops it with exit status 1.
pub async fn replay(args: &[String]) -> Result<()> {
    let o = parse(args)?;
    let server = server_from_env();
    select(&server, &o.profile).await?;
    server.echo_steps(true);
    let r = server
        .recording_replay(Parameters(RecordingReplayArgs {
            id: o.id,
            from: o.from,
            values: (!o.values.is_empty()).then_some(o.values),
            tab_id: None,
        }))
        .await
        .map_err(|e| anyhow!("{}", e.message))?;
    if server.echoed() == 0 {
        // Refused before the first step (no recording, no profile): the
        // reason is in the answer, not on the screen yet.
        println!("{}", lines(&r).join("\n"));
    }
    if failed(&r) {
        bail!("the replay did not finish");
    }
    Ok(())
}
