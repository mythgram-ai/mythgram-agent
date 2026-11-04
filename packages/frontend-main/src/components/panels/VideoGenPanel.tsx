import { Clapperboard } from "lucide-react";
import { ExternalToolsPanel, Highlight } from "@/components/panels/ExternalToolsPanel";

/**
 * Video generation workspace.
 *
 * Video generation is provided through external tools: add a video-capable MCP
 * server or connect a video app. This panel explains that and links to both.
 */
export function VideoGenPanel() {
  return (
    <ExternalToolsPanel
      kicker="Create video from text"
      title="Video generation"
      intro="Turn a prompt into a video. Video generation is powered by external tools, so connect a provider before you ask the agent to render one."
      Icon={Clapperboard}
      calloutTitle="Use MCP servers and Connectors for video generation"
      calloutBody={
        <>
          Add a <Highlight>video-capable MCP server</Highlight> or connect a{" "}
          <Highlight>video app</Highlight> from Connectors. Once connected, the agent can generate
          video with it just like any other tool.
        </>
      }
      mcpDescription="Add an MCP server that exposes video generation to the agent."
      connectorDescription="Connect a third-party video app the agent can use."
    />
  );
}
