// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

export type FetchProgressEvent = {
  requestId: string;
  rowsFetched: number;
  elapsedMs: number;
};

let _activeRequestId = $state<string | null>(null);
let _rowsFetched = $state(0);
let _elapsedMs = $state(0);
let _isStreaming = $state(false);

export const fetchProgress = {
  get activeRequestId() {
    return _activeRequestId;
  },
  get rowsFetched() {
    return _rowsFetched;
  },
  get elapsedMs() {
    return _elapsedMs;
  },
  get isStreaming() {
    return _isStreaming;
  },
  start(requestId: string): void {
    _activeRequestId = requestId;
    _rowsFetched = 0;
    _elapsedMs = 0;
    _isStreaming = true;
  },
  update(evt: FetchProgressEvent): void {
    // Only honor events for the active request — late-arriving events from a
    // previous query that was cancelled or completed should not stomp on the
    // new query's counters.
    if (evt.requestId !== _activeRequestId) return;
    _rowsFetched = evt.rowsFetched;
    _elapsedMs = evt.elapsedMs;
  },
  stop(): void {
    _isStreaming = false;
  },
  reset(): void {
    _activeRequestId = null;
    _rowsFetched = 0;
    _elapsedMs = 0;
    _isStreaming = false;
  },
};
