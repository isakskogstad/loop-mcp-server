# Loop MCP Server

Remote MCP (Model Context Protocol) server for [LoopDesk](https://www.loopdesk.se) — Swedish corporate events, news, and company data.

Connect via Claude Desktop, Claude Web, or any MCP-compatible client.

## Tools

### Supabase — News & Events

- `loop_search_news` — Search news cards by keyword, company, date, category
- `loop_get_news_item` — Get a single news card with full details
- `loop_list_recent_news` — Latest news, filterable by category/type
- `loop_get_company` — Company info + recent events
- `loop_search_companies` — Search by name or impact niche
- `loop_get_company_financials` — Financial data (revenue, profit, employees)
- `loop_get_company_directors` — Board and director info
- `loop_get_company_events` — All events for a company
- `loop_search_protocols` — Search corporate protocols
- `loop_search_kungorelser` — Search official announcements
- `loop_query_table` — Flexible query against any Supabase table
- `loop_list_tables` — List all available database tables

### Pinecone

- `loop_semantic_search` — Semantic search over impactloop.se articles
- `loop_list_pinecone_indexes` — List available Pinecone indexes

### Slack

- `loop_send_slack_message` — Send message to editorial channel

### Web

- `loop_web_search` — Live web search via Tavily

## Setup

### Claude Desktop / Claude Web

Add to your MCP settings:

```json
{
  "mcpServers": {
    "loop": {
      "url": "https://loop-mcp-production.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Self-hosting

```bash
git clone https://github.com/isakskogstad/loop-mcp-server.git
cd loop-mcp-server
cp .env.example .env  # Edit with your keys
npm install
npm run build
npm start
```

## Environment Variables

| Variable               | Required | Description                                      |
| ---------------------- | -------- | ------------------------------------------------ |
| `LOOP_MCP_API_KEY`     | No       | Bearer token for auth (skip = open)              |
| `SUPABASE_URL`         | Yes      | Supabase project URL                             |
| `SUPABASE_SERVICE_KEY` | Yes      | Supabase service role key                        |
| `PINECONE_API_KEY`     | No       | Pinecone API key                                 |
| `PINECONE_INDEX_HOST`  | No       | Pinecone index host (auto-discovered if not set) |
| `PINECONE_INDEX_NAME`  | No       | Pinecone index name for auto-discovery           |
| `SLACK_BOT_TOKEN`      | No       | Slack bot token                                  |
| `SLACK_CHANNEL_ID`     | No       | Default Slack channel                            |
| `TAVILY_API_KEY`       | No       | Tavily API key for web search                    |

## Tech Stack

- TypeScript + Express
- MCP SDK (`@modelcontextprotocol/sdk`)
- Streamable HTTP transport (stateless JSON mode)
- Supabase, Pinecone, Slack Web API

## Deployment

Deployed on Railway via Docker. Health check: `GET /health`.
