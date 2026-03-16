import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BRIGHTDATA_MCP_URL = "https://mcp.brightdata.com/mcp";

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
        // Call Bright Data MCP search_engine tool via their MCP endpoint
        const response = await fetch(
          `${BRIGHTDATA_MCP_URL}?token=${token}&tools=search_engine`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "search_engine",
                arguments: {
                  query: params.query,
                  engine: "google",
                  geo_location: "se",
                },
              },
            }),
          }
        );

        if (!response.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Bright Data API returned status ${
                  response.status
                }: ${await response.text()}`,
              },
            ],
            isError: true,
          };
        }

        const raw = (await response.json()) as {
          result?: { content?: Array<{ text?: string }> };
          error?: { message?: string };
        };

        if (raw.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${
                  raw.error.message ?? JSON.stringify(raw.error)
                }`,
              },
            ],
            isError: true,
          };
        }

        const text =
          raw.result?.content?.[0]?.text ?? JSON.stringify(raw.result);

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
        const response = await fetch(
          `${BRIGHTDATA_MCP_URL}?token=${token}&tools=scrape_as_markdown`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "scrape_as_markdown",
                arguments: {
                  url: params.url,
                },
              },
            }),
          }
        );

        if (!response.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Bright Data API returned status ${
                  response.status
                }: ${await response.text()}`,
              },
            ],
            isError: true,
          };
        }

        const raw = (await response.json()) as {
          result?: { content?: Array<{ text?: string }> };
          error?: { message?: string };
        };

        if (raw.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${
                  raw.error.message ?? JSON.stringify(raw.error)
                }`,
              },
            ],
            isError: true,
          };
        }

        const text =
          raw.result?.content?.[0]?.text ?? JSON.stringify(raw.result);

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
