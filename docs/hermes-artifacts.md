# Artifacts and sharing

Hermes-backed chats support LibreChat's Artifacts presentation mode. Start a new chat, open the composer tools menu and select Artifacts. Normal mode supplies LibreChat's supported artifact instructions; shadcn/ui adds UI-component instructions, while Custom expects the Hermes profile to provide its own artifact instructions.

Hermes generates the response and executes any tools. LibreChat renders supported artifact markup in its preview panel. Native LibreChat code execution, MCP, skills and memory remain disabled for this transport.

To share, open Chat options, choose Share, and create a shared link. Shared conversation pages include the artifact preview. The link includes the selected conversation branch, not only a standalone artifact; review the messages before creating it. In this pilot, new links are available to everyone with the link. Use Manage Access to restrict access to selected people or groups. The share dialog reports that edits to existing shared messages appear immediately; use Update link to include new messages. Delete the shared link to revoke access.

The Hermes workspace entry sits below the main sidebar icons. Opening it expands the sidebar and replaces the chat list with Hermes's section links, profile selector, refresh action and publication controls. The pane uses LibreChat's sidebar theme. The iframe fills the main content area without a LibreChat header or toolbar above it.

Artifacts can be edited and downloaded from the panel. HTML, React, SVG, Markdown and Mermaid content emitted in LibreChat's artifact format are supported. Arbitrary files saved only in the Hermes filesystem are not automatically imported as LibreChat attachments or published by sharing a chat.
