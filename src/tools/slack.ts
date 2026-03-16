import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebClient } from "@slack/web-api";
import { z } from "zod";

let _client: WebClient | null = null;
function getClient(): WebClient {
  if (!_client) {
    _client = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return _client;
}

export function registerSlackTools(server: McpServer): void {
  server.registerTool(
    "loop_send_slack_message",
    {
      description:
        "Post a message to the Loop editorial team's Slack workspace. Defaults to the main editorial channel (SLACK_CHANNEL_ID). Use this to share news summaries, alerts, or analysis results with the team. Returns the message timestamp (ts) and channel ID on success.",
      inputSchema: {
        message: z
          .string()
          .min(1)
          .max(4000)
          .describe("The message text to send to Slack"),
        channel: z
          .string()
          .optional()
          .describe(
            "Slack channel ID to post to. Defaults to the SLACK_CHANNEL_ID environment variable."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (params) => {
      if (!process.env.SLACK_BOT_TOKEN) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Slack is not configured. Set the SLACK_BOT_TOKEN environment variable.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await getClient().chat.postMessage({
          channel: params.channel || process.env.SLACK_CHANNEL_ID || "",
          text: params.message,
        });

        const data = { ok: true, ts: result.ts, channel: result.channel };

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
