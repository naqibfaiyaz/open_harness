# Live Hermes activity

The private executor observes `hermes.tool.progress` SSE events while forwarding
the original response bytes unchanged. Hermes owns every tool call; these events
never enter LibreChat's native tool execution loop.

The authenticated `/api/hermes/progress/:conversation` read endpoint is
scoped to the signed-in LibreChat user and the conversation's current foreground
generation. LibreChat runs one foreground generation per conversation. Starting a
new run retires the previous presentation lease, and delayed callbacks cannot
revive it. Completed runs are excluded from this live feed. The query cache also
keys on LibreChat's submission-start epoch, so a new turn gets fresh state without
depending on when the assistant's temporary message ID is replaced.
No management permission is required to read one's
own activity. Tool arguments, preview labels and results are excluded.

During submission, the composer polls once per second and shows a collapsible
activity panel with running/completed tools. Unfinished tools become interrupted
when the response stream closes. Completion means the tool finished, not that its
result was successful. Missing or malformed events never fail a chat.

This pilot uses bounded, process-local presentation state: `hermes.progressMaxRuns`
(128), `progressMaxTools` (100 per run), and `progressRetentionMs` (1,800,000).
These fields are configurable in `librechat.yaml`. Eviction only affects the
activity display. The 64 KiB metadata framing guard ignores oversized event frames
without modifying the chat stream. It is a parser safety bound, not an inference
limit. The panel is live only and is not included in saved messages or shared chats.
Restarts clear the feed; multiple LibreChat processes would need a shared store.
