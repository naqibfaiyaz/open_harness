# Interactive graphs and generated files

Open Harness prioritizes interactive LibreChat artifacts for graph, chart and dashboard
requests. The server adds the presentation contract to the Hermes system context on
every turn, including model aliases and follow-ups. It asks for a complete, self-contained
HTML/SVG/JavaScript artifact (or suitable React artifact) with embedded real data,
accessible controls and clearly labeled dates, currency and limitations. Static images
and documents remain supporting downloads; an explicit request for only a static export
is respected. Model output still needs the usual accuracy checks; enabling this guidance
does not guarantee that a model follows every instruction or that source data is correct.

The contract gives each conversation a private export directory:

```
/opt/data/cache/librechat-deliveries/<opaque server-derived session key>/
```

Hermes writes a file directly there and emits `MEDIA:/.../filename.ext` outside any code
fence or artifact. After generation completes, LibreChat reads it through the private
dashboard plugin, saves it in the existing persistent uploads volume and native File
collection, and attaches the result to the saved assistant message. Image attachments
have an authenticated inline preview; other files have native authenticated download
links. Imported files survive Hermes scratch-cache cleanup and normal server restarts.
Re-importing the same bytes for the same message/filename uses the same file ID.

Directory identity comes from the trusted user and conversation passed by the server,
never from a model-selected session or a caller-selected filesystem root. Only flat
filenames in that exact directory can be imported. The private reader rejects traversal,
symlinked ancestors/directories/files, hardlinks, directories, pipes and files exceeding
the configured bound. Its endpoint requires the private bridge credential as well as
dashboard authentication. Files remain under LibreChat's existing owner/download/share
authorization; they are not copied into the publicly served images directory. Public
artifact sharing continues to use the existing share permissions and snapshots.

The code does not import arbitrary historical `MEDIA:` paths. Repairing an old scratch
file requires an explicit, authorized migration into the owning chat. The shared Hermes
runtime remains the existing execution boundary: this delivery mechanism does not make
arbitrary shell execution safe or create new per-user containers inside an organization.

Deployment enables the following `hermes` configuration fields; upstream defaults for
the two capabilities remain false:

```yaml
hermes:
  artifactsEnabledByDefault: true
  interactiveGraphs: true
  deliverFiles: true
  deliveryMaxFiles: 8
  deliveryMaxBytes: 20971520
```

Each file has a bounded sequential read; at most eight files are imported per completion
by default. Unsafe paths, missing or oversized files produce a safe retry notice while
retaining the assistant's answer. The dashboard reader has a hard ceiling of 25 MiB.
Interactive artifact source and inline code examples are never rewritten as file markers.
Native OpenAI-compatible external API calls receive the presentation guidance, but their
frontend owns persistence and file handling; this post-generation attachment integration
is part of the LibreChat message lifecycle.

Tests cover private storage, user/conversation namespaces, marker de-duplication,
failed/oversized downloads, code/artifact preservation and actual POSIX no-follow reads.
The deployment's existing typechecks and integration/UI checks run before rollout.
