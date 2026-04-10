/**
 * Lexicon Mapper template: the default landing experience.
 *
 * Demonstrates the full protolab pipeline by mapping a raw atproto
 * `app.bsky.feed.post` record into a simplified "timeline event" shape
 * via a real 4-step lens chain:
 *
 *     source (app.bsky.feed.post)
 *         │
 *         ▼
 *   rename_field (text → body)
 *   rename_field (createdAt → timestamp)
 *   compute_field (charCount = len(body))
 *   add_field (source = "bluesky")
 *         │
 *         ▼
 *     target (timeline event)
 *
 * Expected forward output for the canonical post:
 *
 *   {
 *     "body": "Hello, ATProtocol!",
 *     "timestamp": "2024-01-15T12:00:00.000Z",
 *     "charCount": 18,
 *     "source": "bluesky"
 *   }
 *
 * The lens chain is four real circuit components wired head-to-tail,
 * visible and editable in edit mode (Cmd+E). The presentation layer —
 * heading, paragraph, lexicon importer, I/O, run button — is stored
 * separately in `presentationDoc`, NOT as circuit vertices. That's
 * what keeps the edit-mode circuit clean.
 *
 * The template also auto-resolves `app.bsky.feed.post` against
 * lexicon.garden's XRPC endpoint and seeds the input with the canonical
 * example record, so Run is immediately meaningful.
 */

import {
  useCircuitStore,
  type PresentationDoc,
  type PresentationWidget,
} from "../../store/circuitStore";
import * as wasm from "../../wasm/bridge";

const LEXICON_GARDEN_XRPC =
  "https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon";

const DEFAULT_NSID = "app.bsky.feed.post";

const CANONICAL_POST = {
  text: "Hello, ATProtocol!",
  createdAt: "2024-01-15T12:00:00.000Z",
};

interface ComponentSpec {
  type: string;
  params: Array<[string, string]>;
}

/**
 * The real lens chain. Four components wired in order. Topological
 * order = listed order.
 */
const LENS_CHAIN: ComponentSpec[] = [
  {
    type: "rename_field",
    params: [
      ["old_name", "text"],
      ["new_name", "body"],
    ],
  },
  {
    type: "rename_field",
    params: [
      ["old_name", "createdAt"],
      ["new_name", "timestamp"],
    ],
  },
  {
    type: "compute_field",
    params: [
      ["target", "charCount"],
      ["expr", "len(body)"],
    ],
  },
  {
    type: "add_field",
    params: [
      ["field_name", "source"],
      ["field_kind", "string"],
      ["default", "bluesky"],
    ],
  },
];

/**
 * The presentation layer: UI chrome that wraps the circuit. These are
 * pure Zustand-state widgets, NOT circuit nodes. Two-column layout:
 * heading + paragraph + lexicon import span the top, input/output sit
 * in the middle columns, run button spans the bottom.
 */
function buildPresentationDoc(): PresentationDoc {
  const widgets: PresentationWidget[] = [
    {
      id: "w_heading",
      kind: "heading",
      column: "",
      x: 40,
      y: 30,
      props: { text: "Lexicon Mapper", level: "1" },
    },
    {
      id: "w_paragraph",
      kind: "paragraph",
      column: "",
      x: 40,
      y: 70,
      props: {
        text: "This lens is bidirectional: press Cmd+E to reveal the full circuit and try editing the output.",
      },
    },
    {
      id: "w_lens_chain",
      kind: "lens_chain",
      column: "",
      x: 40,
      y: 110,
      props: {},
    },
    {
      id: "w_lexicon",
      kind: "lexicon_import",
      column: "",
      x: 40,
      y: 180,
      props: { label: "Source schema", default_nsid: DEFAULT_NSID },
    },
    {
      id: "w_input",
      kind: "input_json",
      column: "left",
      x: 40,
      y: 360,
      props: { label: "Input (atproto post)" },
    },
    {
      id: "w_output",
      kind: "output_json",
      column: "right",
      x: 540,
      y: 360,
      props: { label: "Output (timeline event)" },
    },
    {
      id: "w_run",
      kind: "run_button",
      column: "",
      x: 40,
      y: 720,
      props: { label: "Run mapping" },
    },
  ];

  return {
    title: "Lexicon Mapper",
    layout: "form",
    widgets,
  };
}

/**
 * Instantiate the Lexicon Mapper template.
 *
 * 1. Create a fresh empty circuit (no demo contamination).
 * 2. Install the presentation layer via `setPresentationDoc`.
 * 3. Add the 4 real lens components, wire them head-to-tail.
 * 4. Apply component params.
 * 5. Resolve `app.bsky.feed.post` from lexicon.garden and assign it as
 *    the circuit's source schema.
 * 6. Seed the input with the canonical post record.
 */
export async function loadLexiconMapperTemplate(): Promise<void> {
  // (1) Fresh circuit.
  const oldHandle = useCircuitStore.getState().circuitHandle;
  const newHandle = wasm.createEmptyCircuit();
  if (oldHandle !== null && oldHandle !== newHandle) {
    try {
      wasm.free_handle(oldHandle);
    } catch {
      // Ignore: the slab may already have freed it.
    }
  }
  useCircuitStore.setState({
    circuitHandle: newHandle,
    nodes: [],
    edges: [],
    sourceSchemaHandle: null,
    importedSchemas: [],
    outputDataJson: "",
    wireDataMap: {},
    evaluationError: null,
  });

  // (2) Presentation layer — set this FIRST so the UI enters
  // presentation mode immediately rather than blocking on the network
  // fetch in step (5). This is what the e2e tests wait on.
  useCircuitStore.getState().setPresentationDoc(buildPresentationDoc());

  // (6) Seed the input with the canonical post record eagerly (before
  // the async resolve in step 5) so the UI is populated right away.
  useCircuitStore.getState().setInputData(JSON.stringify(CANONICAL_POST, null, 2));

  // (3) Add the real lens chain.
  const beforeIds = new Set(useCircuitStore.getState().nodes.map((n) => n.id));
  LENS_CHAIN.forEach((spec, i) => {
    useCircuitStore.getState().addComponent(spec.type, 100 + i * 260, 120);
  });
  const after = useCircuitStore.getState().nodes;
  const lens = after.filter((n) => !beforeIds.has(n.id));

  // (4) Apply params.
  lens.forEach((node, i) => {
    const spec = LENS_CHAIN[i];
    if (!spec) return;
    for (const [k, v] of spec.params) {
      useCircuitStore.getState().updateParam(node.id, k, v);
    }
  });

  // Wire the chain: out → in.
  for (let i = 0; i < lens.length - 1; i++) {
    const src = `${lens[i].id}.out`;
    const tgt = `${lens[i + 1].id}.in`;
    try {
      useCircuitStore.getState().connectPorts(src, tgt);
    } catch (err) {
      console.warn(`lexiconMapper: failed to wire ${src} → ${tgt}:`, err);
    }
  }

  // (5) Auto-resolve the default lexicon and assign as source schema.
  // This is fire-and-forget: we don't await it so the template returns
  // immediately and the UI enters presentation mode without blocking on
  // a network fetch. If the fetch succeeds, the schema is installed in
  // the background; if it fails, the user can hit Resolve manually.
  resolveDefaultLexicon();
}

async function resolveDefaultLexicon(): Promise<void> {
  try {
    const url = `${LEXICON_GARDEN_XRPC}?nsid=${encodeURIComponent(DEFAULT_NSID)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const body = await res.json();
    if (!body || typeof body.schema !== "object") return;
    const result = wasm.parseAtprotoLexicon(JSON.stringify(body.schema));
    useCircuitStore.setState((s) => ({
      importedSchemas: [
        ...s.importedSchemas,
        {
          handle: result.handle,
          name: `${DEFAULT_NSID} (lexicon, ${result.summary.vertex_count}V)`,
          protocol: result.summary.protocol,
          vertexCount: result.summary.vertex_count,
          edgeCount: result.summary.edge_count,
        },
      ],
    }));
    useCircuitStore.getState().assignSourceSchema(result.handle);
  } catch (err) {
    console.warn("lexiconMapper: auto-resolve failed:", err);
  }
}
