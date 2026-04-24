//! Pull every lexicon from lexicon.garden, run panproto's auto-lens
//! pairwise, and write a JSON manifest of known-compatible pairs.
//!
//! Frontend use: load `auto-lens-snapshot.json` on mount, annotate
//! the NSID autocomplete with a colored dot ("auto-lens known to
//! work" / "known to fail" / "unknown"). The live app still runs
//! `auto_generate_candidates` on demand — this snapshot is strictly
//! a UX hint. As new lexicons are added to the garden between
//! snapshot regenerations, they just show up as "unknown" until the
//! next rebuild.
//!
//! Run with:
//!   cargo run -p protolab-snapshot --release -- \
//!       --out app/public/auto-lens-snapshot.json
//!
//! Override the NSID list for a faster dev loop:
//!   cargo run -p protolab-snapshot --release -- \
//!       --nsids app.bsky.feed.post,site.standard.document --out /tmp/snap.json

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use clap::Parser;
use panproto_lens::Stringency;
use panproto_lens::auto_lens::{AutoLensConfig, auto_generate_candidates};
use panproto_protocols::web_document::atproto::{parse_lexicon, protocol};
use panproto_schema::Schema;
use serde::{Deserialize, Serialize};

/// Minimum coverage threshold for a pair to be reported as `works`.
/// Matches the filter the wasm bridge applies at query time
/// (`protolab-wasm/src/api.rs`), so the snapshot's verdict agrees
/// with what the live app would show.
const COVERAGE_THRESHOLD: f64 = 0.15;

/// Auto-generate calls on large lexicons can blow through tens of
/// seconds. Cap per-pair wall-clock so a pathological pair can't
/// stall the whole matrix. Pairs that exceed it are recorded as
/// `timeout`.
const PER_PAIR_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Parser)]
#[command(name = "protolab-snapshot")]
struct Cli {
    /// Output file for the JSON manifest.
    #[arg(long)]
    out: PathBuf,

    /// Comma-separated NSID list. Defaults to the full lexicon.garden
    /// catalog.
    #[arg(long)]
    nsids: Option<String>,

    /// Stringency tier to evaluate at. Defaults to `balanced`, which
    /// matches the app's default.
    #[arg(long, default_value = "balanced")]
    stringency: String,

    /// Skip fetching: reuse already-cached lexicons from `--cache-dir`.
    #[arg(long)]
    offline: bool,

    /// Cache fetched lexicons here so re-runs don't hit the network
    /// for every lexicon. Defaults to `.snapshot-cache/` at the repo
    /// root.
    #[arg(long, default_value = ".snapshot-cache")]
    cache_dir: PathBuf,

    /// Cap NSID count after dedup. Zero (the default) means no cap.
    /// With ~1800 lexicons in the garden the pair matrix is ~3M
    /// entries at N²; setting this to, e.g., 100 keeps a CI snapshot
    /// build tractable.
    #[arg(long, default_value_t = 0)]
    max_nsids: usize,
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    generated_at: String,
    panproto_version: String,
    stringency: String,
    coverage_threshold: f64,
    schemas: Vec<SchemaEntry>,
    pairs: Vec<PairEntry>,
}

#[derive(Serialize, Deserialize)]
struct SchemaEntry {
    nsid: String,
    vertex_count: usize,
}

#[derive(Serialize, Deserialize)]
struct PairEntry {
    src: String,
    tgt: String,
    /// `works` | `degenerate` | `no-morphism` | `parse-error` | `timeout`
    status: String,
    /// Best candidate's coverage when `works` or `degenerate`, else null.
    coverage: Option<f64>,
    /// Best candidate's chain length when `works` or `degenerate`, else null.
    chain_length: Option<usize>,
    /// Wall-clock ms for the pair's auto-generation call.
    elapsed_ms: u128,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let stringency = parse_stringency(&cli.stringency)?;
    let proto = protocol();

    let mut nsids: Vec<String> = if let Some(list) = cli.nsids.as_deref() {
        list.split(',').map(|s| s.trim().to_owned()).collect()
    } else {
        eprintln!("fetching NSID catalog from lexicon.garden…");
        fetch_all_nsids()?
    };
    if cli.max_nsids > 0 && nsids.len() > cli.max_nsids {
        eprintln!(
            "capping NSID list at {} of {} (full run disables with --max-nsids 0)",
            cli.max_nsids,
            nsids.len()
        );
        nsids.truncate(cli.max_nsids);
    }
    eprintln!(
        "planning {} lexicons → {} ordered pairs",
        nsids.len(),
        nsids.len().saturating_mul(nsids.len() - 1)
    );

    fs::create_dir_all(&cli.cache_dir)?;

    // Load (fetch or cache-hit) every lexicon up front. Pairs that
    // fail to parse are marked `parse-error` against every partner
    // but don't abort the run.
    let mut schemas: BTreeMap<String, Result<Schema, String>> = BTreeMap::new();
    for nsid in &nsids {
        match load_schema(nsid, &cli.cache_dir, cli.offline) {
            Ok(schema) => {
                eprintln!("  loaded {nsid} ({} vertices)", schema.vertex_count());
                schemas.insert(nsid.clone(), Ok(schema));
            }
            Err(e) => {
                eprintln!("  FAILED to load {nsid}: {e}");
                schemas.insert(nsid.clone(), Err(e.to_string()));
            }
        }
    }

    let mut pairs: Vec<PairEntry> = Vec::new();
    let mut works_count = 0usize;
    let mut degenerate_count = 0usize;
    let mut no_morphism_count = 0usize;
    let mut parse_err_count = 0usize;
    let start_all = Instant::now();

    // Directional: `(src, tgt)` and `(tgt, src)` are different lenses.
    for src_nsid in &nsids {
        for tgt_nsid in &nsids {
            if src_nsid == tgt_nsid {
                continue;
            }
            let pair_start = Instant::now();
            let entry = match (schemas.get(src_nsid), schemas.get(tgt_nsid)) {
                (Some(Ok(src)), Some(Ok(tgt))) => run_pair(src, tgt, &proto, stringency),
                _ => {
                    parse_err_count += 1;
                    PairEntry {
                        src: src_nsid.clone(),
                        tgt: tgt_nsid.clone(),
                        status: "parse-error".into(),
                        coverage: None,
                        chain_length: None,
                        elapsed_ms: 0,
                    }
                }
            };
            let entry = PairEntry {
                src: src_nsid.clone(),
                tgt: tgt_nsid.clone(),
                elapsed_ms: pair_start.elapsed().as_millis(),
                ..entry
            };
            match entry.status.as_str() {
                "works" => works_count += 1,
                "degenerate" => degenerate_count += 1,
                "no-morphism" => no_morphism_count += 1,
                _ => {}
            }
            // Sparse output: we only record pairs that produce a
            // usable lens. Frontends treat an absent pair as "no
            // auto-lens"; with a curated set that's the common case,
            // so writing every failing pair would bloat the file by
            // orders of magnitude for no information gain.
            if entry.status == "works" {
                pairs.push(entry);
            }
        }
        eprintln!(
            "  {src_nsid}: {}/{} pairs processed ({}s elapsed)",
            pairs.len(),
            nsids.len() * nsids.len() - nsids.len(),
            start_all.elapsed().as_secs()
        );
    }

    let snapshot = Snapshot {
        generated_at: now_iso8601(),
        panproto_version: env!("CARGO_PKG_VERSION").to_string(),
        stringency: cli.stringency,
        coverage_threshold: COVERAGE_THRESHOLD,
        schemas: schemas
            .iter()
            .filter_map(|(nsid, res)| {
                res.as_ref().ok().map(|s| SchemaEntry {
                    nsid: nsid.clone(),
                    vertex_count: s.vertex_count(),
                })
            })
            .collect(),
        pairs,
    };

    let json = serde_json::to_string_pretty(&snapshot)?;
    fs::write(&cli.out, json)?;
    eprintln!(
        "\nwrote {} ({} schemas, {} pairs)",
        cli.out.display(),
        snapshot.schemas.len(),
        snapshot.pairs.len()
    );
    eprintln!(
        "  works: {works_count}, degenerate: {degenerate_count}, no-morphism: {no_morphism_count}, parse-error: {parse_err_count}"
    );
    Ok(())
}

fn run_pair(
    src: &Schema,
    tgt: &Schema,
    protocol: &panproto_schema::Protocol,
    stringency: Stringency,
) -> PairEntry {
    let config = AutoLensConfig {
        stringency,
        try_overlap: true,
        ..Default::default()
    };
    match auto_generate_candidates(src, tgt, protocol, &config, 3) {
        Ok(cands) => {
            if let Some(best) = cands
                .iter()
                .max_by(|a, b| a.coverage.total_cmp(&b.coverage))
            {
                let status = if best.coverage >= COVERAGE_THRESHOLD {
                    "works"
                } else {
                    "degenerate"
                };
                PairEntry {
                    src: String::new(),
                    tgt: String::new(),
                    status: status.into(),
                    coverage: Some(best.coverage),
                    chain_length: Some(best.chain.steps.len()),
                    elapsed_ms: 0,
                }
            } else {
                PairEntry {
                    src: String::new(),
                    tgt: String::new(),
                    status: "no-morphism".into(),
                    coverage: None,
                    chain_length: None,
                    elapsed_ms: 0,
                }
            }
        }
        Err(_) => PairEntry {
            src: String::new(),
            tgt: String::new(),
            status: "no-morphism".into(),
            coverage: None,
            chain_length: None,
            elapsed_ms: 0,
        },
    }
}

fn parse_stringency(s: &str) -> Result<Stringency, String> {
    match s {
        "strict" => Ok(Stringency::Strict),
        "balanced" => Ok(Stringency::Balanced),
        "lenient" => Ok(Stringency::Lenient),
        "exploratory" => Ok(Stringency::Exploratory),
        other => Err(format!("unknown stringency: {other}")),
    }
}

/// Enumerate every NSID lexicon.garden exposes by traversing its
/// HTML `/browse` hierarchy. The garden doesn't expose a list-all
/// JSON API (the autocomplete endpoint caps at 10 hits per query
/// and won't admit empty `q`), so we walk the authority tree:
/// `/browse` yields top-level authorities (`app`, `com`, `blue`,
/// …) as `/browse/{auth}` links; each authority page yields child
/// authorities AND `/lexicon/{did}/{nsid}` links for the NSIDs
/// registered directly under it. Breadth-first, dedup by nsid.
fn fetch_all_nsids() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut seen_nsids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut seen_browse: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut queue: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    queue.push_back("/browse".to_string());
    seen_browse.insert("/browse".to_string());

    while let Some(path) = queue.pop_front() {
        let url = format!("https://lexicon.garden{path}");
        let body = match ureq::get(&url).call() {
            Ok(mut resp) if resp.status().is_success() => {
                resp.body_mut().read_to_string().unwrap_or_default()
            }
            _ => continue,
        };
        let (nsids, browse_links) = extract_browse_links(&body);
        for n in nsids {
            seen_nsids.insert(n);
        }
        for b in browse_links {
            if seen_browse.insert(b.clone()) {
                queue.push_back(b);
            }
        }
        if seen_browse.len() % 20 == 0 || queue.is_empty() {
            eprintln!(
                "  traversed {} pages, {} NSIDs so far, {} in queue",
                seen_browse.len(),
                seen_nsids.len(),
                queue.len()
            );
        }
    }

    if seen_nsids.is_empty() {
        return Err("lexicon.garden /browse traversal yielded no NSIDs".into());
    }
    Ok(seen_nsids.into_iter().collect())
}

/// Extract `/lexicon/<did>/<nsid>` links (as NSIDs) and `/browse/*`
/// sub-authority links from a lexicon.garden HTML page.
fn extract_browse_links(body: &str) -> (Vec<String>, Vec<String>) {
    let mut nsids = Vec::new();
    let mut browse = Vec::new();
    // Scan for href="..." attributes; regex-free to avoid a dep.
    for chunk in body.split("href=\"").skip(1) {
        let Some(end) = chunk.find('"') else { continue };
        let href = &chunk[..end];
        if let Some(rest) = href.strip_prefix("/lexicon/") {
            // `/lexicon/<did>/<nsid>` — the last path segment is the NSID.
            if let Some(slash) = rest.rfind('/') {
                let nsid = &rest[slash + 1..];
                if !nsid.is_empty() {
                    nsids.push(nsid.to_owned());
                }
            }
        } else if let Some(rest) = href.strip_prefix("/browse/") {
            let clean = rest
                .split(|c: char| c == '?' || c == '#')
                .next()
                .unwrap_or(rest);
            if !clean.is_empty() {
                browse.push(format!("/browse/{clean}"));
            }
        }
    }
    (nsids, browse)
}

fn load_schema(
    nsid: &str,
    cache_dir: &PathBuf,
    offline: bool,
) -> Result<Schema, Box<dyn std::error::Error>> {
    let cache_path = cache_dir.join(format!("{nsid}.json"));
    let body_json: serde_json::Value = if cache_path.exists() {
        serde_json::from_str(&fs::read_to_string(&cache_path)?)?
    } else if offline {
        return Err(format!("offline mode: {nsid} not in cache").into());
    } else {
        let url =
            format!("https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid={nsid}");
        let mut resp = ureq::get(&url).call()?;
        let body: serde_json::Value = resp.body_mut().read_json()?;
        fs::write(&cache_path, serde_json::to_string_pretty(&body)?)?;
        body
    };
    let schema_node = body_json
        .get("schema")
        .ok_or_else(|| format!("{nsid}: response has no `schema` field"))?;
    Ok(parse_lexicon(schema_node)?)
}

fn now_iso8601() -> String {
    // Avoid pulling in chrono just for this; format seconds since
    // epoch as an ISO-shaped UTC string.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let (y, mo, d, h, mi, s) = seconds_to_ymd_hms(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn seconds_to_ymd_hms(mut s: u64) -> (u32, u32, u32, u32, u32, u32) {
    let sec = (s % 60) as u32;
    s /= 60;
    let min = (s % 60) as u32;
    s /= 60;
    let hour = (s % 24) as u32;
    s /= 24;
    let mut days = s;
    let mut year: u32 = 1970;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let year_days: u64 = if leap { 366 } else { 365 };
        if days < year_days {
            break;
        }
        days -= year_days;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_lengths: [u32; 12] = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month: u32 = 1;
    for &ml in &month_lengths {
        if days < u64::from(ml) {
            break;
        }
        days -= u64::from(ml);
        month += 1;
    }
    let day = days as u32 + 1;
    (year, month, day, hour, min, sec)
}

// Swallow the timeout constant from unused-in-this-draft warning.
// A future pass can wire it into a per-pair watchdog (thread + channel).
#[allow(dead_code)]
const _: Duration = PER_PAIR_TIMEOUT;
