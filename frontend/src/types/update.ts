export interface ExecuteUpdateResult {
  operations: ExecuteUpdateResultEntry[],
  time: ExecuteUpdateGlobalTimeStats
}

export interface ExecuteUpdateResultEntry {
  deltaTriples: DeltaTriples;
  status: 'OK' | 'ERROR';
  time: TimeInfo;
  update: string;
  warnings: string[];
}

export interface ExecuteUpdateGlobalTimeStats {
  total: number,
  parsing: number,
  waitingForUpdateThread: number,
  acquiringDeltaTriplesWriteLock: number,
  operations: number,
  metadataUpdateForSnapshot: number,
  diskWriteback: number,
  snapshotCreation: number,
}

export interface TimeInfo {
  total: number;
  planning: number;
  where: number;
  update: UpdateTiming;
}

export interface UpdateTiming {
  total: number;
  preparation: number;
  delete: number;
  insert: number;
}

export interface DeltaTriples {
  operation: TripleDelta;
  before: TripleDelta;
  after: TripleDelta;
  difference: TripleDelta;
}

export interface TripleDelta {
  total: number;
  deleted: number;
  inserted: number;
}
