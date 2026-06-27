/**
 * helpers.ts — shared test scaffolding.
 *
 * Drives the REAL server through a REAL MCP client over an in-process linked
 * transport pair (no sockets, no stdio, no network). This exercises the exact
 * JSON-RPC framing, schema validation, and tool-dispatch path a production client
 * hits — just without a portal behind it. Any tool that reaches the portal HTTP
 * client will fail without credentials, so contract tests deliberately stick to
 * the no-network surface (tools/list, schema rejection, rule validation, gating).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

export interface Connected {
  client: Client;
  close: () => Promise<void>;
}

/** Build a fresh server and connect a client to it over a linked in-memory pair. */
export async function connect(): Promise<Connected> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);

  const client = new Client({ name: "zuar-portal-mcp-test", version: "0.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Names of all tools the server currently advertises. */
export async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name).sort();
}

/** The text payload of a tool result (first text content block). */
export function resultText(res: { content?: Array<{ type: string; text?: string }> }): string {
  const first = (res.content ?? []).find((c) => c.type === "text");
  return first?.text ?? "";
}
