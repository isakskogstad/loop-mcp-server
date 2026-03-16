import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BRIGHTDATA_MCP_BASE = "https://mcp.brightdata.com";

/**
 * Calls a Bright Data MCP tool using proper initialize → tools/call flow.
 */
async function callBrightDataTool(
  token: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  // Step 1: Initialize and get session ID
  const initRes = await fetch(
    `${BRIGHTDATA_MCP_BASE}/mcp?token=${token}&tools=${toolName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "loop-mcp-server", version: "1.0.0" },
        },
      }),
    }
  );

  if (!initRes.ok) {
    throw new Error(
      `Bright Data initialize failed: ${initRes.status} ${await initRes.text()}`
    );
  }

  // Get session ID from response header
  const sessionId = initRes.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error("No MCP-Session-Id returned from Bright Data initialize");
  }

  // Step 2: Call the tool with the session ID
  const callRes = await fetch(
    `${BRIGHTDATA_MCP_BASE}/mcp?token=${token}&tools=${toolName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    }
  );

  if (!callRes.ok) {
    throw new Error(
      `Bright Data tool call failed: ${callRes.status} ${await callRes.text()}`
    );
  }

  const raw = (await callRes.json()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string; code?: number };
  };

  if (raw.error) {
    throw new Error(raw.error.message ?? JSON.stringify(raw.error));
  }

  return raw.result?.content?.[0]?.text ?? JSON.stringify(raw.result);
}

export function registerWebTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // loop_web_search — Bright Data search engine
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_web_search",
    {
      title: "Web search",
      description:
        "Search the web using Bright Data (Google). Use for information not available in Loop's database.",
      inputSchema: {
        query: z
          .string()
          .min(2)
          .max(400)
          .describe("The search query to look up on the web"),
        num_results: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Number of search results to return (default 5, max 10)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const token = process.env.BRIGHTDATA_MCP_TOKEN;
      if (!token) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Web search is not configured. Set the BRIGHTDATA_MCP_TOKEN environment variable.",
            },
          ],
          isError: true,
        };
      }

      try {
        const text = await callBrightDataTool(token, "search_engine", {
          query: params.query,
          engine: "google",
          geo_location: "se",
        });

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: "Error: " + message }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // loop_scrape_url — Bright Data URL scraper
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_scrape_url",
    {
      title: "Scrape URL",
      description:
        "Scrape a web page and return its content as markdown. Use for reading articles, company pages, etc.",
      inputSchema: {
        url: z.string().url().describe("The URL to scrape"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const token = process.env.BRIGHTDATA_MCP_TOKEN;
      if (!token) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Web scraping is not configured. Set the BRIGHTDATA_MCP_TOKEN environment variable.",
            },
          ],
          isError: true,
        };
      }

      try {
        const text = await callBrightDataTool(token, "scrape_as_markdown", {
          url: params.url,
        });

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: "Error: " + message }],
          isError: true,
        };
      }
    }
  );
}
