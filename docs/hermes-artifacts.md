# Artifacts and sharing

Hermes-backed chats support LibreChat's Artifacts presentation mode. Start a new chat, open the composer tools menu and select Artifacts. Normal mode supplies LibreChat's supported artifact instructions; shadcn/ui adds UI-component instructions, while Custom expects the Hermes profile to provide its own artifact instructions.

Hermes generates the response and executes any tools. LibreChat renders supported artifact markup in its preview panel. Native LibreChat code execution, MCP, skills and memory remain disabled for this transport.

To share, use the conversation's Share action and choose access in its sharing dialog. Shared conversation pages include the artifact preview. Sharing is an explicit snapshot of the selected conversation branch, not a standalone artifact-only website; review the messages before creating the link. Subsequent edits require updating the shared snapshot. Public links can be opened without signing in when public access is selected. Delete the shared link to revoke access.

Artifacts can be edited and downloaded from the panel. HTML, React, SVG, Markdown and Mermaid content emitted in LibreChat's artifact format are supported. Arbitrary files saved only in the Hermes filesystem are not automatically imported as LibreChat attachments or published by sharing a chat.
