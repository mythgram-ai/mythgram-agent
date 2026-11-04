import { Music } from "lucide-react";
import { ExternalToolsPanel, Highlight } from "@/components/panels/ExternalToolsPanel";

/**
 * Music generation workspace.
 *
 * Music generation is provided through external tools: add a music/audio-capable
 * MCP server or connect a music app. This panel explains that and links to both.
 */
export function MusicGenPanel() {
  return (
    <ExternalToolsPanel
      kicker="Create music from text"
      title="Music generation"
      intro="Turn a prompt into music or audio. Music generation is powered by external tools, so connect a provider before you ask the agent to compose one."
      Icon={Music}
      calloutTitle="Use MCP servers and Connectors for music generation"
      calloutBody={
        <>
          Add a <Highlight>music-capable MCP server</Highlight> or connect a{" "}
          <Highlight>music app</Highlight> from Connectors. Once connected, the agent can generate
          music with it just like any other tool.
        </>
      }
      mcpDescription="Add an MCP server that exposes music generation to the agent."
      connectorDescription="Connect a third-party music app the agent can use."
    />
  );
}
