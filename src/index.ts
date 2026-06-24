#!/usr/bin/env node
/**
 * index.ts — stdio entrypoint for the Zuar Portal MCP server.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { log } from "./config.js";

async function init(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server ready on stdio");
}

init().catch((e: unknown) => {
  console.error("Fatal:", (e as Error).message);
  process.exit(1);
});
