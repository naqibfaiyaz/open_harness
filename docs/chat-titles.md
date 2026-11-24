# Conversation titles

LibreChat requests a title from the first prompt using its native title lifecycle.
The private `__hermes_chat_title__` adapter calls the bundled `open-harness-titles`
dashboard plugin with server authentication. The plugin calls Hermes'
`agent.oneshot.run_oneshot(task='title_generation')`; it does not construct an agent,
run tools, or write session history. Credentials remain inside Hermes.

Model selection follows Hermes' existing `auxiliary.title_generation` configuration
and provider resolution. Configure that auxiliary task in Hermes to choose a
different title model. This adds one small model request per new conversation.

Only text from the first user prompt is sent, capped at 8,000 characters for this
metadata operation. Attachment contents and later turns are excluded. The helper
requests 3–7 words, allows up to 128 output tokens and waits up to 25 seconds inside
the dashboard client's existing 30-second deadline. Titles must be a single line
of at most 120 characters. These are private metadata protocol bounds rather than
limits on normal chat requests. If generation fails or the result is invalid, the
first five prompt words provide a fallback. Existing titles are not migrated.

The plugin is mounted read-only under the pinned Hermes image's bundled plugin
directory, and requires the bridge key in addition to dashboard authentication.
No new container or public endpoint is needed. Automatic releases pin its files to
the same Git commit as the LibreChat image, including rollback mounts.
