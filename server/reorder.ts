/**
 * Plan the fewest "move X after Y" operations that turn `current` into `target`.
 *
 * Items on a longest increasing subsequence (by current position) stay put;
 * every other item is moved directly after its predecessor in `target`
 * (or to the top when it is first). Processing in target order guarantees the
 * predecessor is already in its final place when an item is moved after it.
 */
export interface Move {
  id: string;
  after: string | null;
}

export function planMoves(current: string[], target: string[]): Move[] {
  const pos = new Map(current.map((id, i) => [id, i]));
  const seq = target.filter((id) => pos.has(id));
  const keep = longestIncreasing(seq.map((id) => pos.get(id)!)).map((i) => seq[i]);
  const keepSet = new Set(keep);

  const moves: Move[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (!keepSet.has(seq[i])) moves.push({ id: seq[i], after: i === 0 ? null : seq[i - 1] });
  }
  return moves;
}

/** Apply moves to a list the same way Plex does (used for tests and local simulation). */
export function simulate(list: string[], moves: Move[]): string[] {
  const out = [...list];
  for (const m of moves) {
    out.splice(out.indexOf(m.id), 1);
    out.splice(m.after === null ? 0 : out.indexOf(m.after) + 1, 0, m.id);
  }
  return out;
}

/** Returns indices (into `values`) of one longest strictly increasing subsequence. */
function longestIncreasing(values: number[]): number[] {
  const tails: number[] = []; // index into values of the smallest tail for each length
  const prev: number[] = new Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const result: number[] = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k !== -1; k = prev[k]) result.push(k);
  return result.reverse();
}
