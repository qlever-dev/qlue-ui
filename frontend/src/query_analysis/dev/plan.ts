// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { QueryExecutionNode, QueryMeta } from '../../types/query_execution_tree';

/**
 * A node of the simulated query plan: the static shape of the tree plus how
 * the node is supposed to behave during execution.
 */
export interface PlanNode {
  description: string;
  column_names: string[];
  /** Rows the operation ends up producing. */
  rows: number;
  /** How long the operation itself takes (simulated milliseconds). */
  duration: number;
  /** Served from the cache: completes instantly. */
  cached?: boolean;
  /** Materializes lazily, i.e. produces rows while its parent already runs. */
  lazy?: boolean;
  /** Skipped by the engine: does no work of its own, only its children run. */
  optimizedOut?: boolean;
  /** Fails when it would complete, which fails the whole query. */
  fails?: boolean;
  details?: Record<string, unknown>;
  children?: PlanNode[];
}

const scan = (
  description: string,
  columns: string[],
  rows: number,
  duration: number,
  extra: Partial<PlanNode> = {}
): PlanNode => ({
  description,
  column_names: columns,
  rows,
  duration,
  details: { 'triple-count': rows, 'permutation-used': 'PSO' },
  ...extra,
});

/**
 * A plan roughly shaped like a QLever plan for
 *
 *   SELECT ?person ?name ?birthplace ?placeName WHERE {
 *     ?person wdt:P31 wd:Q5 ; rdfs:label ?name ; wdt:P19 ?birthplace .
 *     ?birthplace wdt:P17 wd:Q183 ; rdfs:label ?placeName .
 *   } ORDER BY ?name LIMIT 100
 *
 * It is timed so the run passes through every node status: the scan for
 * ?birthplace wdt:P17 wd:Q183 fails while the lazy JOIN on ?person still runs
 * (cancelled) and before the ?placeName scan starts (not started).
 */
export const DEFAULT_PLAN: PlanNode = {
  description: 'SORT / ORDER BY on ?name',
  column_names: ['?person', '?name', '?birthplace', '?placeName'],
  rows: 84_231,
  duration: 3500,
  children: [
    {
      description: 'JOIN on ?birthplace',
      column_names: ['?person', '?name', '?birthplace', '?placeName'],
      rows: 84_231,
      duration: 5000,
      lazy: true,
      children: [
        {
          description: 'JOIN on ?person',
          column_names: ['?person', '?name', '?birthplace'],
          rows: 412_884,
          duration: 20_000,
          lazy: true,
          children: [
            {
              description: 'JOIN on ?person',
              column_names: ['?person', '?name'],
              rows: 9_312_004,
              duration: 9000,
              children: [
                scan('INDEX SCAN ?person wdt:P31 wd:Q5', ['?person'], 9_512_331, 4500),
                {
                  description: 'SORT on ?person',
                  column_names: ['?person', '?name'],
                  rows: 108_442_010,
                  duration: 0,
                  optimizedOut: true,
                  children: [
                    scan(
                      'INDEX SCAN ?person rdfs:label ?name',
                      ['?person', '?name'],
                      108_442_010,
                      7000,
                      {
                        cached: true,
                      }
                    ),
                  ],
                },
              ],
            },
            scan(
              'INDEX SCAN ?person wdt:P19 ?birthplace',
              ['?person', '?birthplace'],
              6_204_112,
              6000,
              { lazy: true }
            ),
          ],
        },
        {
          description: 'JOIN on ?birthplace',
          column_names: ['?birthplace', '?placeName'],
          rows: 121_004,
          duration: 4000,
          children: [
            {
              description: 'INDEX SCAN ?birthplace wdt:P17 wd:Q183',
              column_names: ['?birthplace'],
              rows: 121_004,
              duration: 25_000,
              fails: true,
              details: { 'triple-count': 121_004, 'permutation-used': 'POS' },
            },
            scan(
              'INDEX SCAN ?birthplace rdfs:label ?placeName',
              ['?birthplace', '?placeName'],
              48_918_220,
              3000
            ),
          ],
        },
      ],
    },
  ],
};

/**
 * Query planning info with one component per combination worth rendering:
 * both planners, tiny to huge components, subgraph counts well below, right at
 * and capped above the budget (`budget + 1`, which switches to greedy), and a
 * few different budgets.
 */
export const DEFAULT_META: QueryMeta = {
  time_query_planning: 37,
  query_planning: [
    // a single triple: nothing to join
    {
      algorithm: 'dynamic-programming',
      num_nodes: 1,
      num_connected_subgraphs: 1,
      budget: 1500,
      num_candidate_plans: 0,
    },
    // a simple join of two triples
    {
      algorithm: 'dynamic-programming',
      num_nodes: 2,
      num_connected_subgraphs: 3,
      budget: 1500,
      num_candidate_plans: 4,
    },
    // a small star
    {
      algorithm: 'dynamic-programming',
      num_nodes: 5,
      num_connected_subgraphs: 31,
      budget: 1500,
      num_candidate_plans: 212,
    },
    // a path of eight triples
    {
      algorithm: 'dynamic-programming',
      num_nodes: 8,
      num_connected_subgraphs: 36,
      budget: 1500,
      num_candidate_plans: 486,
    },
    // a larger star, still comfortably within the budget
    {
      algorithm: 'dynamic-programming',
      num_nodes: 10,
      num_connected_subgraphs: 1023,
      budget: 1500,
      num_candidate_plans: 18_944,
    },
    // exactly at the budget: still dynamic programming
    {
      algorithm: 'dynamic-programming',
      num_nodes: 11,
      num_connected_subgraphs: 1500,
      budget: 1500,
      num_candidate_plans: 31_207,
    },
    // one over the budget: greedy
    {
      algorithm: 'greedy',
      num_nodes: 11,
      num_connected_subgraphs: 1501,
      budget: 1500,
      num_candidate_plans: 1_342,
    },
    // a big star, way over the budget
    {
      algorithm: 'greedy',
      num_nodes: 24,
      num_connected_subgraphs: 1501,
      budget: 1500,
      num_candidate_plans: 5_816,
    },
    // a small budget forces greedy even for a small component
    {
      algorithm: 'greedy',
      num_nodes: 6,
      num_connected_subgraphs: 11,
      budget: 10,
      num_candidate_plans: 97,
    },
    // a budget of zero: always greedy
    {
      algorithm: 'greedy',
      num_nodes: 3,
      num_connected_subgraphs: 1,
      budget: 0,
      num_candidate_plans: 12,
    },
    // a large budget keeps a big component on dynamic programming
    {
      algorithm: 'dynamic-programming',
      num_nodes: 16,
      num_connected_subgraphs: 65_535,
      budget: 100_000,
      num_candidate_plans: 2_904_311,
    },
    // huge component with a large budget, still over it
    {
      algorithm: 'greedy',
      num_nodes: 40,
      num_connected_subgraphs: 100_001,
      budget: 100_000,
      num_candidate_plans: 48_220,
    },
  ],
};

/** Builds the initial (nothing executed yet) tree for a plan. */
export function toQueryExecutionTree(plan: PlanNode): QueryExecutionNode {
  return {
    cache_status: 'computed',
    children: (plan.children ?? []).map(toQueryExecutionTree),
    column_names: plan.column_names,
    description: plan.description,
    details: plan.details ?? null,
    estimated_column_multiplicities: plan.column_names.map(() => 1),
    estimated_operation_cost: Math.round(plan.rows * 1.3),
    estimated_size: Math.round(plan.rows * 1.2),
    estimated_total_cost: Math.round(plan.rows * 2.1),
    operation_time: 0,
    original_operation_time: 0,
    original_total_time: 0,
    result_cols: plan.column_names.length,
    result_rows: 0,
    status: 'not started',
    total_time: 0,
  };
}
