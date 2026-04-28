export type CacheStatus = 'cached_not_pinned' | 'computed';

export type NodeStatus =
  | 'not started'
  | 'optimized out'
  | 'failed'
  | 'failed because child failed'
  | 'cancelled'
  | 'fully materialized in progress'
  | 'fully materialized completed'
  | 'lazily materialized in progress'
  | 'lazily materialized completed';

export type NodeDetails = Record<string, any>;

export interface QueryExecutionNode {
  /** Unique ID. */
  id?: number;
  /** Cache state of the operation. */
  cache_status: CacheStatus;
  /** Child operations. */
  children: QueryExecutionNode[];
  /** Column names of the result. */
  column_names: string[];
  /** Description of the operation. */
  description: string;
  /** Additional details about the operation. */
  details: NodeDetails | null;
  estimated_column_multiplicities: number[];
  /** cost (excluding descendants) estimate (unitless). */
  estimated_operation_cost: number;
  /** size estimate (number or rows) of the result. */
  estimated_size: number;
  /** total cost (including descendants) estimate (unitless). */
  estimated_total_cost: number;
  /** operation time excluding descendants. */
  operation_time: number;
  /** operation time of the cached operation (if it was cached) */
  original_operation_time: number;
  /** total time of the cached operation (if it was cached) */
  original_total_time: number;
  /** Number of columns of the result of the operation. */
  result_cols: number;
  /** Number of rows of the result of the operation. */
  result_rows: number;
  /** status of the operation.
   * - lazily materialized: lazy operation started marterializing
   * - not started: operation did not start jet
   * - in progress: operation started evaluating
   * */
  status: NodeStatus;
  /** operation time including descendants */
  total_time: number;
}

// Type alias for the root node (same structure)
export type QueryExecutionTree = QueryExecutionNode;

// Example usage:
// const tree: QueryExecutionTree = { ... };
