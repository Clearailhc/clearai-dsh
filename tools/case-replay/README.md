# Recorded acceptance case in official DSH

This development-only plugin loads an actual acceptance run through the official `sessions.create(..., {seed, meta})` and workspace APIs. It does not modify DSH source, manufacture research events, or invoke a model. The isolated launcher passes no provider credentials and disables title generation. It is not shipped in the ClearAI npm package.

Use a completed run and its matching immutable workspace snapshot:

```json
{
  "run": "/tmp/campaign/runs/clearai-3",
  "workspace": "/tmp/campaign/snapshots/clearai-3",
  "receipt": "/tmp/case-replay-receipt.json"
}
```

```bash
node tools/case-replay/start.mjs \
  --host-node-modules /tmp/clearai-dsh-cli/node_modules \
  --config /tmp/case-replay.json --port 3096 > /tmp/case-replay.log 2>&1
# In another terminal, after the web server is ready:
node tools/case-replay/capture.mjs \
  /tmp/case-replay.log /tmp/case-replay-receipt.json /tmp/case-shots
```

Build the production package first. The capture tool exercises the official Ontology and Explore tabs, full-screen graph, keyboard object inspection, and 375/768/1440 px views. It records source-session and production-bundle hashes alongside image hashes. The web log contains a local authentication token: keep it private. Original session logs may contain model reasoning; do not publish them with screenshots.

The screenshots show **real recorded task state replayed in DSH**, not a recording of the original live execution. The session title makes that distinction visible. Do not send prompts from this review profile or use the replay as evidence of new execution, live update latency, or lower model cost.

Pass `--video` after the three capture arguments to save `replay.webm`. This records the browser walkthrough of the archived state, starting after opening Ontology; it does not record the original task execution.
