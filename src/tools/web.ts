import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
}

export function registerWebTools(server: McpServer): void {
  server.registerTool(
    "loop_web_search",
    {
      description: "Live web search via Tavily API.",
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
      },
    },
    async (params) => {
      if (!process.env.TAVILY_API_KEY) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Web search is not configured. Set the TAVILY_API_KEY environment variable.",
            },
          ],
          isError: true,
        };
      }

      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: params.query,
            max_results: params.num_results,
            search_depth: "basic",
            include_answer: true,
          }),
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Tavily API returned status ${response.status}`,
              },
            ],
            isError: true,
          };
        }

        const raw = (await response.json()) as TavilyResponse;

        const data = {
          answer: raw.answer,
          results: (raw.results ?? []).map((r: TavilyResult) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
          })),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: " + message,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
