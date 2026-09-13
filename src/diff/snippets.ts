// Per-language snippet bank. The generator stitches snippets together to
// fill files to their target line count. Each snippet is plausibly idiomatic
// code so the tokenizer has something realistic to chew on.

import type { Language } from "../store/diff.ts";

export type Snippet = readonly string[];

const TYPESCRIPT_SNIPPETS: readonly Snippet[] = [
  ['import { readFile } from "node:fs/promises";'],
  ['import { z } from "zod";'],
  ['import type { Request, Response } from "express";'],
  ["export interface Config {", "  port: number;", "  host: string;", "  debug: boolean;", "}"],
  [
    "export type Result<T, E = Error> =",
    "  | { ok: true; value: T }",
    "  | { ok: false; error: E };",
  ],
  [
    "export function clamp(n: number, min: number, max: number): number {",
    "  return Math.max(min, Math.min(max, n));",
    "}",
  ],
  [
    "export async function loadConfig(path: string): Promise<Config> {",
    '  const raw = await readFile(path, "utf8");',
    "  return JSON.parse(raw) as Config;",
    "}",
  ],
  ["if (user === undefined) {", '  throw new Error("unauthenticated");', "}"],
  ["for (const item of items) {", "  total += item.price * item.quantity;", "}"],
  ["const cache = new Map<string, number>();", "cache.set(key, value);"],
  ["return items.filter((x) => x.active).map((x) => x.id);"],
  [
    "export class RateLimiter {",
    "  private readonly bucket = new Map<string, number>();",
    "  constructor(private readonly capacity: number) {}",
    "",
    "  allow(key: string): boolean {",
    "    const n = this.bucket.get(key) ?? 0;",
    "    if (n >= this.capacity) return false;",
    "    this.bucket.set(key, n + 1);",
    "    return true;",
    "  }",
    "}",
  ],
  [
    "switch (event.type) {",
    '  case "open":',
    "    handleOpen(event);",
    "    break;",
    '  case "close":',
    "    handleClose(event);",
    "    break;",
    "  default:",
    "    handleUnknown(event);",
    "}",
  ],
  ["// TODO: revisit once the migration lands"],
  [
    "try {",
    "  await send(payload);",
    "} catch (err) {",
    '  log.warn("send failed", { err });',
    "}",
  ],
];

const PYTHON_SNIPPETS: readonly Snippet[] = [
  ["import os", "import json", "from pathlib import Path"],
  ["from dataclasses import dataclass", "from typing import Optional"],
  ["@dataclass", "class Config:", "    port: int", "    host: str", "    debug: bool = False"],
  [
    "def load_config(path: str) -> dict:",
    '    with open(path, "r", encoding="utf-8") as fp:',
    "        return json.load(fp)",
  ],
  [
    "class Cache:",
    "    def __init__(self) -> None:",
    "        self._data: dict[str, int] = {}",
    "",
    "    def get(self, key: str) -> int | None:",
    "        return self._data.get(key)",
    "",
    "    def set(self, key: str, value: int) -> None:",
    "        self._data[key] = value",
  ],
  ["if user is None:", '    raise PermissionError("unauthenticated")'],
  ["for item in items:", "    total += item.price * item.quantity"],
  ["def clamp(n: float, lo: float, hi: float) -> float:", "    return max(lo, min(hi, n))"],
  ["# TODO: handle the empty case"],
  [
    "try:",
    "    response = client.send(payload)",
    "except TimeoutError as err:",
    '    logger.warning("send timed out: %s", err)',
    "    response = None",
  ],
  ['if __name__ == "__main__":', "    main()"],
  ["results = [", "    transform(x)", "    for x in source", "    if x.active", "]"],
  [
    "async def fetch_all(urls: list[str]) -> list[bytes]:",
    "    async with httpx.AsyncClient() as client:",
    "        tasks = [client.get(u) for u in urls]",
    "        responses = await asyncio.gather(*tasks)",
    "    return [r.content for r in responses]",
  ],
];

const GO_SNIPPETS: readonly Snippet[] = [
  ["package main", "", 'import "fmt"'],
  ["import (", '\t"context"', '\t"net/http"', '\t"time"', ")"],
  ["type Config struct {", "\tPort  int", "\tHost  string", "\tDebug bool", "}"],
  [
    "func handler(w http.ResponseWriter, r *http.Request) {",
    '\tfmt.Fprintf(w, "hello, %s", r.URL.Path)',
    "}",
  ],
  ["if err != nil {", '\treturn fmt.Errorf("decode: %w", err)', "}"],
  ["for _, item := range items {", "\ttotal += item.Price * item.Quantity", "}"],
  [
    "func clamp(n, lo, hi int) int {",
    "\tif n < lo {",
    "\t\treturn lo",
    "\t}",
    "\tif n > hi {",
    "\t\treturn hi",
    "\t}",
    "\treturn n",
    "}",
  ],
  ["ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)", "defer cancel()"],
  [
    "select {",
    "case msg := <-ch:",
    "\thandle(msg)",
    "case <-ctx.Done():",
    "\treturn ctx.Err()",
    "}",
  ],
  ["// TODO(@owner): retry with backoff"],
  [
    "type Server struct {",
    "\tmu    sync.Mutex",
    "\tconns map[string]net.Conn",
    "}",
    "",
    "func (s *Server) Close(id string) error {",
    "\ts.mu.Lock()",
    "\tdefer s.mu.Unlock()",
    "\tc, ok := s.conns[id]",
    "\tif !ok {",
    "\t\treturn ErrUnknownConn",
    "\t}",
    "\tdelete(s.conns, id)",
    "\treturn c.Close()",
    "}",
  ],
];

const RUST_SNIPPETS: readonly Snippet[] = [
  ["use std::collections::HashMap;", "use std::sync::Arc;"],
  ["use serde::{Deserialize, Serialize};"],
  [
    "#[derive(Debug, Clone, Serialize, Deserialize)]",
    "pub struct Config {",
    "    pub port: u16,",
    "    pub host: String,",
    "    #[serde(default)]",
    "    pub debug: bool,",
    "}",
  ],
  [
    "impl Display for Error {",
    "    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {",
    '        write!(f, "{}", self.message)',
    "    }",
    "}",
  ],
  [
    "pub fn parse(input: &str) -> Result<Config, ParseError> {",
    "    let value: Value = serde_json::from_str(input)?;",
    "    Ok(Config::try_from(value)?)",
    "}",
  ],
  [
    "if let Some(user) = users.get(&id) {",
    '        tracing::info!(?user, "loaded");',
    "} else {",
    "    return Err(Error::NotFound);",
    "}",
  ],
  ["for item in items.iter() {", "    total += item.price * item.quantity as u64;", "}"],
  ["pub fn clamp(n: i64, lo: i64, hi: i64) -> i64 {", "    n.max(lo).min(hi)", "}"],
  ["// TODO: switch to once_cell when the MSRV bumps"],
  [
    "match event {",
    "    Event::Open(id) => handle_open(id),",
    "    Event::Close(id) => handle_close(id),",
    '    Event::Other(kind) => tracing::warn!(%kind, "unknown event"),',
    "}",
  ],
  [
    "pub async fn fetch(url: &str) -> Result<Bytes, FetchError> {",
    "    let response = CLIENT.get(url).send().await?;",
    "    let body = response.bytes().await?;",
    "    Ok(body)",
    "}",
  ],
];

const JSON_SNIPPETS: readonly Snippet[] = [
  ['  "name": "example",'],
  ['  "version": "1.0.0",'],
  ['  "private": true,'],
  ['  "license": "MIT",'],
  ['  "type": "module",'],
  [
    '  "scripts": {',
    '    "build": "tsc",',
    '    "test": "jest",',
    '    "lint": "eslint ."',
    "  },",
  ],
  ['  "dependencies": {', '    "lodash": "^4.17.21",', '    "zod": "^3.22.0"', "  },"],
  ['  "devDependencies": {', '    "typescript": "^5.4.0",', '    "@types/node": "^20.0.0"', "  },"],
  ['  "engines": {', '    "node": ">=20"', "  },"],
  [
    '  "repository": {',
    '    "type": "git",',
    '    "url": "git+https://github.com/example/repo.git"',
    "  },",
  ],
];

const BANK: Record<Language, readonly Snippet[]> = {
  typescript: TYPESCRIPT_SNIPPETS,
  python: PYTHON_SNIPPETS,
  go: GO_SNIPPETS,
  rust: RUST_SNIPPETS,
  json: JSON_SNIPPETS,
};

export function snippetsFor(language: Language): readonly Snippet[] {
  return BANK[language];
}
