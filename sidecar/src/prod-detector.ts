// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

export interface ProductionScore {
  score: number;
  confidence: "high" | "medium" | "low" | "none";
  isProbablyProduction: boolean;
  signals: string[];
}

export interface ProdDetectorParams {
  host?: string;
  service?: string;
  sid?: string;
  connectString?: string;
  username?: string;
}

export function detectProduction(params: ProdDetectorParams): ProductionScore {
  let score = 0;
  const signals: string[] = [];

  const host = params.host ?? "";
  const service = params.service ?? "";
  const sid = params.sid ?? "";
  const connectString = params.connectString ?? "";
  const username = (params.username ?? "").toUpperCase();

  if (/\b(prd|prod|production|live|master)\b/i.test(host)) {
    score += 40;
    signals.push(`host matches production pattern: ${host}`);
  }
  if (/\b(prd|prod|production)\b/i.test(service)) {
    score += 30;
    signals.push(`service matches production pattern: ${service}`);
  }
  if (/\b(prd|prod|production)\b/i.test(sid)) {
    score += 25;
    signals.push(`SID matches production pattern: ${sid}`);
  }
  if (/\b(prd|prod|live)\b/i.test(connectString)) {
    score += 20;
    signals.push("connect string matches production pattern");
  }
  if (username === "SYS" || username === "SYSTEM") {
    score += 20;
    signals.push(`privileged username: ${username}`);
  }
  if (/\b(dev|development|test|uat|stg|staging|qa|sandbox)\b/i.test(host)) {
    score -= 40;
    signals.push(`host matches development pattern: ${host}`);
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    score -= 50;
    signals.push("local host");
  }
  if (/\b(dev|test|uat|stg|staging|qa)\b/i.test(service)) {
    score -= 20;
  }
  if (/\b(dev|test|uat|stg|staging|qa)\b/i.test(sid)) {
    score -= 20;
  }

  const confidence: ProductionScore["confidence"] =
    score >= 50 ? "high" : score >= 30 ? "medium" : score >= 10 ? "low" : "none";

  return { score, confidence, isProbablyProduction: score >= 30, signals };
}
