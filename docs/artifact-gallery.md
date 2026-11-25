# Persistent artifact access and gallery

Hermes chats automatically enable the native shadcn artifact output instructions.
Users no longer need to attach the Artifacts option for every message. Existing
explicit artifact modes are preserved; Hermes still owns all agent execution.
This is controlled by `hermes.artifactsEnabledByDefault` (schema default false;
the Open Harness deployment generator explicitly enables it).

The signed-in sidebar has an **Artifact gallery** link at `/artifacts`.
The authenticated `/api/artifact-gallery` endpoint reads artifacts from saved
assistant messages belonging to the requesting user, within the current tenant.
It includes existing `:::artifact` outputs and file-backed attachments, so no
manual re-save or migration is required. Search uses literal title/source text;
results paginate over messages. Deleting or expiring the source message removes
it from future gallery reads rather than leaving a second unmanaged copy.
The gallery is private to the user; it does not publish or share artifacts.

Gallery links carry the conversation, message and stable artifact identity.
The chat selects the source branch, scrolls to its trigger and opens the existing
artifact viewer. The artifact remains editable/downloadable through that viewer.

Chat triggers include thumbnails. HTML/SVG previews are sanitized, lazy-loaded,
sandboxed without permissions, and protected by a restrictive CSP that blocks
scripts, remote resources and form submissions. React and other source artifacts
show static source previews rather than executing code merely to make a thumbnail.
The full interactive preview remains available after opening the artifact.
Thumbnails are reconstructed from saved source; there is no browser-only gallery
cache and no separate screenshot service or additional AWS infrastructure.

Model context still has its normal conversation/token limits. Enabling artifact
creation by default does not grant an agent access to other users' chats or inject
the entire personal gallery into every request. Existing artifacts in the active
conversation remain available through its chat history.

Fixed gallery page/preview response bounds limit authenticated read amplification.
They do not limit how much artifact source the chat retains. Source edits saved by
the existing artifact editor are reflected on subsequent gallery requests.
