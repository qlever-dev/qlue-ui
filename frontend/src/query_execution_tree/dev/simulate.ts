// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { QueryExecutionNode } from '../../types/query_execution_tree';
import type { PlanNode } from './plan';
import { toQueryExecutionTree } from './plan';

interface Scheduled {
  plan: PlanNode;
  /** When the subtree rooted here starts computing. */
  start: number;
  /** When this operation itself starts working, i.e. once its children are done. */
  ownStart: number;
  end: number;
  children: Scheduled[];
}

/**
 * Assigns every operation a start and an end on a simulated timeline.
 *
 * Children run left to right, and a lazy child lets the next sibling start
 * before it is done. An operation counts as running as soon as anything below
 * it runs — that is what makes the whole chain from the root down to the
 * currently computing operation active, like it is during a real execution.
 */
function schedule(plan: PlanNode, t: number): Scheduled {
  let cursor = t;
  const children = (plan.children ?? []).map((child) => {
    const scheduled = schedule(child, cursor);
    cursor = child.lazy ? scheduled.start + child.duration * 0.3 : scheduled.end;
    return scheduled;
  });
  const start = children.length > 0 ? children[0].start : t;
  const ownStart = children.length > 0 ? cursor : t;
  // NOTE: an operation cannot finish before its inputs do — a pipelined
  // operation still needs a tail after its last child to drain.
  const lastChildEnd = Math.max(t, ...children.map((child) => child.end));
  const end = plan.cached
    ? ownStart
    : Math.max(ownStart + plan.duration, lastChildEnd + plan.duration * 0.25);
  return { plan, start, ownStart, end, children };
}

/** The simulated execution of a plan, sampled at an arbitrary point in time. */
export class Simulation {
  private readonly root: Scheduled;
  readonly duration: number;

  constructor(plan: PlanNode) {
    this.root = schedule(plan, 0);
    this.duration = this.root.end;
  }

  /** The tree as it looks `t` simulated milliseconds into the execution. */
  frameAt(t: number): QueryExecutionNode {
    const tree = toQueryExecutionTree(this.root.plan);
    apply(this.root, tree, t);
    return tree;
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function apply(scheduled: Scheduled, node: QueryExecutionNode, t: number): void {
  scheduled.children.forEach((child, i) => {
    apply(child, node.children[i], t);
  });

  const { plan, start, ownStart, end } = scheduled;
  const childrenTime = node.children.reduce((sum, child) => sum + child.total_time, 0);

  if (t < start) {
    node.status = 'not started';
    node.total_time = childrenTime;
    return;
  }

  if (plan.cached) {
    node.status = 'fully materialized completed';
    node.cache_status = 'cached_not_pinned';
    node.operation_time = 1;
    node.original_operation_time = plan.duration;
    node.original_total_time = plan.duration;
    node.result_rows = plan.rows;
    node.total_time = node.operation_time + childrenTime;
    return;
  }

  const running = t < end;
  // NOTE: a lazy operation already produces rows while its inputs still run,
  // an eager one only once its inputs are done.
  const progress = clamp(plan.lazy ? (t - start) / (end - start) : (t - ownStart) / plan.duration);
  node.operation_time = Math.round(progress * plan.duration);
  node.result_rows = Math.round(progress * plan.rows);
  node.total_time = node.operation_time + childrenTime;
  if (plan.lazy) {
    node.status = running ? 'lazily materialized in progress' : 'lazily materialized completed';
  } else {
    node.status = running ? 'fully materialized in progress' : 'fully materialized completed';
  }
}
