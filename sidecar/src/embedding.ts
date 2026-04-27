// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

export type EmbedProvider = "ollama" | "openai" | "voyage" | "custom";

export type EmbedParams = {
  provider: EmbedProvider;
  model: string;
  text: string;
  baseUrl?: string; // ollama default: http://localhost:11434, custom: any
  apiKey?: string;  // openai / voyage
};

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",           // AWS/Azure/GCP link-local metadata
  "metadata.google.internal",  // GCP metadata
  "metadata.internal",
  "instance-data",
]);

function validateEmbedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid embed URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Embed URL must use http or https (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    throw new Error(`Embed URL targets a blocked host: ${host}`);
  }
}

export async function embedText(params: EmbedParams): Promise<number[]> {
  switch (params.provider) {
    case "ollama":  return embedOllama(params);
    case "openai":  return embedOpenAi(params);
    case "voyage":  return embedVoyage(params);
    case "custom":  return embedCustom(params);
    default: throw new Error(`Unknown embedding provider: ${params.provider}`);
  }
}

async function embedOllama(p: EmbedParams): Promise<number[]> {
  const base = (p.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  if (p.baseUrl) validateEmbedUrl(base);
  const res = await fetch(`${base}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: p.model || "nomic-embed-text", prompt: p.text }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { embedding: number[] };
  if (!Array.isArray(data.embedding)) throw new Error("Ollama returned no embedding");
  return data.embedding;
}

async function embedOpenAi(p: EmbedParams): Promise<number[]> {
  if (!p.apiKey) throw new Error("OpenAI API key required");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({ model: p.model || "text-embedding-3-small", input: p.text }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function embedVoyage(p: EmbedParams): Promise<number[]> {
  if (!p.apiKey) throw new Error("Voyage API key required");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({ model: p.model || "voyage-3-lite", input: [p.text] }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function embedCustom(p: EmbedParams): Promise<number[]> {
  if (!p.baseUrl) throw new Error("Custom provider URL required");
  validateEmbedUrl(p.baseUrl);
  const res = await fetch(p.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: p.model, input: p.text, text: p.text }),
  });
  if (!res.ok) throw new Error(`Custom embed error ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  // Accept: { embedding: [] } | { data: [{ embedding: [] }] } | number[]
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.embedding)) return data.embedding;
  if (Array.isArray(data.data?.[0]?.embedding)) return data.data[0].embedding;
  throw new Error("Could not parse embedding from custom provider response");
}
