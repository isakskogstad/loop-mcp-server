import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPineconeTools(server: McpServer): void {
  server.registerTool(
    "loop_semantic_search",
    {
      title: "Semantic search articles",
      description:
        "Semantic vector search over impactloop.se articles indexed in Pinecone. Returns the most relevant article chunks for a given query.",
      inputSchema: {
        query: z.string().min(2).describe("Search query text"),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe("Number of results to return (default 10, max 30)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (params) => {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Pinecone is not configured. Set the PINECONE_API_KEY environment variable.",
            },
          ],
        };
      }

      try {
        // Use Pinecone inference search REST API for integrated indexes
        const indexHost = process.env.PINECONE_INDEX_HOST;
        if (!indexHost) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Pinecone index host is not configured. Set the PINECONE_INDEX_HOST environment variable (e.g. 'my-index-abc123.svc.pinecone.io').",
              },
            ],
          };
        }

        const response = await fetch(
          `https://${indexHost}/records/namespaces/default/search`,
          {
            method: "POST",
            headers: {
              "Api-Key": apiKey,
              "Content-Type": "application/json",
              "X-Pinecone-API-Version": "2025-04",
            },
            body: JSON.stringify({
              query: {
                top_k: params.top_k,
                inputs: { text: params.query },
              },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Pinecone API error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as {
          result?: { hits?: Array<Record<string, unknown>> };
        };

        const hits = (data.result?.hits ?? []).map(
          (record: Record<string, unknown>) => {
            const { _id, _score, ...rest } = record;
            return { id: _id, score: _score, ...rest };
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(hits, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Pinecone search failed: ${message}`,
            },
          ],
        };
      }
    }
  );
}
