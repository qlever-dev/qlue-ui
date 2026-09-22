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

export type NodeDetails = Record<string, unknown>;

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

/** How the query planner planned one connected component of the query. */
export interface QueryPlanningInfo {
  /** The planner that was used. */
  algorithm: 'dynamic-programming' | 'greedy';
  /** Number of nodes (triples and similar) of the component. */
  num_nodes: number;
  /** Number of connected subgraphs, counted up to `budget + 1`. */
  num_connected_subgraphs: number;
  /** The `query-planning-budget`; above it, the greedy planner is used. */
  budget: number;
  /** Number of candidate plans created for the joins, before pruning. */
  num_candidate_plans: number;
}

/** Information about the query as a whole, sent along with the root node. */
export interface QueryMeta {
  /** Time for the query planning in milliseconds. */
  time_query_planning: number;
  /** How each connected component of the query was planned. */
  query_planning?: QueryPlanningInfo[];
}

/** The root node, which may also carry information about the whole query. */
export type QueryExecutionTree = QueryExecutionNode & { meta?: QueryMeta };

// Example usage:
// const tree: QueryExecutionTree = { ... };
