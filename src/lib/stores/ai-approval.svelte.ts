// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

export type AiApprovalRequest = {
  requestId: string;
  tool: string;
  input: Record<string, unknown>;
  /** When the approval was created on the host clock. Used for timeout countdown UI. */
  receivedAtMs: number;
};

let _queue = $state<AiApprovalRequest[]>([]);

export const aiApproval = {
  /** First pending request (the one the modal shows), or null. */
  get current(): AiApprovalRequest | null {
    return _queue.length > 0 ? _queue[0] : null;
  },
  /** Total count including the current one — useful for "1 of 3" UI affordances. */
  get pendingCount(): number {
    return _queue.length;
  },
  enqueue(req: Omit<AiApprovalRequest, "receivedAtMs">): void {
    // Dedupe by requestId — if a network glitch double-delivers a notification,
    // do not show the same approval twice.
    if (_queue.some((r) => r.requestId === req.requestId)) return;
    _queue = [..._queue, { ...req, receivedAtMs: Date.now() }];
  },
  /** Remove the request matching this id from the queue. Idempotent. */
  resolve(requestId: string): void {
    _queue = _queue.filter((r) => r.requestId !== requestId);
  },
  /** Clear all pending requests — used on workspace close / connection switch. */
  reset(): void {
    _queue = [];
  },
};
