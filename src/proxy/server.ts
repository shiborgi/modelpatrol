import { createServer, type Server } from "node:http";

import type { Config } from "../core/model.js";
import { createContext, handleHttp, type ProxyContext } from "./handle.js";

export interface ProxyHandle {
  server: Server;
  host: string;
  port: number;
  home: string;
  close: () => Promise<void>;
}

export async function startProxy(input: {
  home: string;
  config?: Config;
  host?: string;
  port?: number;
  ctx?: Partial<Omit<ProxyContext, "home" | "config">>;
}): Promise<ProxyHandle> {
  const ctx = createContext(input.home, input.ctx);
  if (input.config) {
    ctx.config = input.config;
  }
  const host = input.host ?? ctx.config.host;
  const requestedPort = input.port ?? ctx.config.port;
  const server = createServer((req, res) => {
    void handleHttp(req, res, ctx).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: { message: String(err) } }));
    });
  });
  const port = await listen(server, host, requestedPort);
  return {
    server,
    host,
    port,
    home: input.home,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
        return;
      }
      resolve(port);
    });
  });
}
