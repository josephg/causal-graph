
// *** TOOLS ***

import PriorityQueue from "priorityqueuejs"
import { lvToPub, rawFindEntryContaining, pubVersionCmp } from "./causal-graph.js"
import { CausalGraph, LV, LVRange } from "./types.js"
import { revRangeRLE, rlePush } from "./rlelist.js"

// export const tieBreakVersions = (cg: CausalGraph, data: LV[]): LV => {
//   if (data.length === 0) throw Error('Cannot tie break from an empty set')
//   let winner = data.reduce((a, b) => {
//     // Its a bit inefficient doing this lookup multiple times for the winning item,
//     // but eh. The data set will almost always contain exactly 1 item anyway.
//     const rawA = lvToRaw(cg, a)
//     const rawB = lvToRaw(cg, b)

//     return versionCmp(rawA, rawB) < 0 ? a : b
//   })

//   return winner
// }

// Its gross that I want / need this, but its super convenient.
export const tieBreakPairs = <T>(cg: CausalGraph, data: [LV, T][]): [LV, T] => {
  if (data.length === 0) throw Error('Cannot tie break from an empty set')
  let winner = data.reduce((a, b) => {
    // Its a bit inefficient doing this lookup multiple times for the winning item,
    // but eh. The data set will almost always contain exactly 1 item anyway.
    const rawA = lvToPub(cg, a[0])
    const rawB = lvToPub(cg, b[0])

    return pubVersionCmp(rawA, rawB) < 0 ? a : b
  })

  return winner
}

type DiffResult = {
  // These are ranges. Unlike the rust code, they're in normal
  // (ascending) order.
  aOnly: LVRange[], bOnly: LVRange[]
}

const pushReversedRLE = (list: LVRange[], start: LV, end: LV) => {
  rlePush(list, revRangeRLE, [start, end] as LVRange)
}


// Numerical values used by utility methods below.
export const enum DiffFlag { A=0, B=1, Shared=2 }

/**
 * This method takes in two versions (expressed as frontiers) and returns the
 * set of operations only appearing in the history of one version or the other.
 */
export const diff = (cg: CausalGraph, a: LV[], b: LV[]): DiffResult => {
  const flags = new Map<number, DiffFlag>()

  // Every order is in here at most once. Every entry in the queue is also in
  // itemType.
  const queue = new PriorityQueue<number>()

  // Number of items in the queue in both transitive histories (state Shared).
  let numShared = 0

  const enq = (v: LV, flag: DiffFlag) => {
    // console.log('enq', v, flag)
    const currentType = flags.get(v)
    if (currentType == null) {
      queue.enq(v)
      flags.set(v, flag)
      // console.log('+++ ', order, type, getLocalVersion(db, order))
      if (flag === DiffFlag.Shared) numShared++
    } else if (flag !== currentType && currentType !== DiffFlag.Shared) {
      // This is sneaky. If the two types are different they have to be {A,B},
      // {A,Shared} or {B,Shared}. In any of those cases the final result is
      // Shared. If the current type isn't shared, set it as such.
      flags.set(v, DiffFlag.Shared)
      numShared++
    }
  }

  for (const v of a) enq(v, DiffFlag.A)
  for (const v of b) enq(v, DiffFlag.B)

  // console.log('QF', queue, flags)

  const aOnly: LVRange[] = [], bOnly: LVRange[] = []

  const markRun = (start: LV, endInclusive: LV, flag: DiffFlag) => {
    if (endInclusive < start) throw Error('end < start')

    // console.log('markrun', start, end, flag)
    if (flag == DiffFlag.Shared) return
    const target = flag === DiffFlag.A ? aOnly : bOnly
    pushReversedRLE(target, start, endInclusive + 1)
  }

  // Loop until everything is shared.
  while (queue.size() > numShared) {
    let v = queue.deq()
    let flag = flags.get(v)!
    // It should be safe to remove the item from itemType here.

    // console.log('--- ', v, 'flag', flag, 'shared', numShared, 'num', queue.size())
    if (flag == null) throw Error('Invalid type')

    if (flag === DiffFlag.Shared) numShared--

    const e = rawFindEntryContaining(cg, v)
    // console.log(v, e)

    // We need to check if this entry contains the next item in the queue.
    while (!queue.isEmpty() && queue.peek() >= e.version) {
      const v2 = queue.deq()
      const flag2 = flags.get(v2)!
      // console.log('pop', v2, flag2)
      if (flag2 === DiffFlag.Shared) numShared--;

      if (flag2 !== flag) { // Mark from v2..=v and continue.
        // v2 + 1 is correct here - but you'll probably need a whiteboard to
        // understand why.
        markRun(v2 + 1, v, flag)
        v = v2
        flag = DiffFlag.Shared
      }
    }

    // console.log(e, v, flag)
    markRun(e.version, v, flag)

    for (const p of e.parents) enq(p, flag)
  }

  aOnly.reverse()
  bOnly.reverse()
  return {aOnly, bOnly}
}


/** Does frontier contain target? */
export const versionContainsLV = (cg: CausalGraph, frontier: LV[], target: LV): boolean => {
  if (frontier.includes(target)) return true

  const queue = new PriorityQueue<number>()
  for (const v of frontier) if (v > target) queue.enq(v)

  while (queue.size() > 0) {
    const v = queue.deq()
    // console.log('deq v')

    // TODO: Will this ever hit?
    if (v === target) return true

    const e = rawFindEntryContaining(cg, v)
    if (e.version <= target) return true

    // Clear any queue items pointing to this entry.
    while (!queue.isEmpty() && queue.peek() >= e.version) {
      queue.deq()
    }

    for (const p of e.parents) {
      if (p === target) return true
      else if (p > target) queue.enq(p)
    }
  }

  return false
}

/** Find the dominators amongst the input versions.
 *
 * Each item in the input will be output to the callback function exactly once.
 *
 * If a version is repeated, it will only ever be counted as a dominator once.
 *
 * The versions will be yielded from largest to smallest.
 */
export function findDominators2(cg: CausalGraph, versions: LV[], cb: (v: LV, isDominator: boolean) => void) {
  if (versions.length === 0) return
  else if (versions.length === 1) {
    cb(versions[0], true)
    return
  }
  else if (versions.length === 2) {
    // We can delegate to versionContainsLV, which is simpler.
    // TODO: Check if this fast path actually helps at all.
    let [v0, v1] = versions
    if (v0 === v1) {
      cb(v0, true)
      cb(v0, false)
    } else {
      if (v0 > v1) [v0, v1] = [v1, v0]
      // v0 < v1. So v1 must be a dominator.
      cb(v1, true)
      // I could use compareVersions, but we'll always hit the same case there.
      cb(v0, !versionContainsLV(cg, [v1], v0))
    }
    return
  }

  // The queue contains (version, isInput) pairs encoded using even/odd numbers.
  const queue = new PriorityQueue<number>()
  for (const v of versions) queue.enq(v * 2)

  let inputsRemaining = versions.length

  while (queue.size() > 0 && inputsRemaining > 0) {
    const vEnc = queue.deq()
    const isInput = (vEnc % 2) === 0
    const v = vEnc >> 1

    if (isInput) {
      cb(v, true)
      inputsRemaining -= 1
    }

    const e = rawFindEntryContaining(cg, v)

    // Clear any queue items pointing to this entry.
    while (!queue.isEmpty() && queue.peek() >= e.version * 2) {
      const v2Enc = queue.deq()
      const isInput2 = (v2Enc % 2) === 0
      if (isInput2) {
        cb(v2Enc >> 1, false)
        inputsRemaining -= 1
      }
    }

    for (const p of e.parents) {
      queue.enq(p * 2 + 1)
    }
  }
}

export function findDominators(cg: CausalGraph, versions: LV[]): LV[] {
  if (versions.length <= 1) return versions
  const result: LV[] = []
  findDominators2(cg, versions, (v, isDominator) => {
    if (isDominator) result.push(v)
  })
  return result.reverse()
}

export const lvEq = (a: LV[], b: LV[]) => (
  a.length === b.length && a.every((val, idx) => b[idx] === val)
)

export function findConflicting(cg: CausalGraph, a: LV[], b: LV[], visit: (range: LVRange, flag: DiffFlag) => void): LV[] {
  // dbg!(a, b);

  // Sorted highest to lowest (so we get the highest item first).
  type TimePoint = {
    v: LV[], // Sorted in inverse order (highest to lowest)
    flag: DiffFlag
  }

  const pointFromVersions = (v: LV[], flag: DiffFlag) => ({
    v: v.length <= 1 ? v : v.slice().sort((a, b) => b - a),
    flag
  })

  // The heap is sorted such that we pull the highest items first.
  // const queue: BinaryHeap<(TimePoint, DiffFlag)> = BinaryHeap::new();
  const queue = new PriorityQueue<TimePoint>((a, b) => {
    for (let i = 0; i < a.v.length; i++) {
      if (b.v.length <= i) return 1
      const c = a.v[i] - b.v[i]
      if (c !== 0) return c
    }
    if (a.v.length < b.v.length) return -1

    return a.flag - b.flag
  })

  queue.enq(pointFromVersions(a, DiffFlag.A));
  queue.enq(pointFromVersions(b, DiffFlag.B));

  // Loop until we've collapsed the graph down to a single element.
  while (true) {
    let {v, flag} = queue.deq()
    // console.log('deq', v, flag)
    if (v.length === 0) return []

    // Discard duplicate entries.

    // I could write this with an inner loop and a match statement, but this is shorter and
    // more readable. The optimizer has to earn its keep somehow.
    // while queue.peek() == Some(&time) { queue.pop(); }
    while (!queue.isEmpty()) {
      const {v: peekV, flag: peekFlag} = queue.peek()
      // console.log('peek', peekV, v, lvEq(v, peekV))
      if (lvEq(v, peekV)) {
        if (peekFlag !== flag) flag = DiffFlag.Shared
        queue.deq()
      } else break
    }

    if (queue.isEmpty()) return v.reverse()

    // If this node is a merger, shatter it.
    if (v.length > 1) {
      // We'll deal with v[0] directly below.
      for (let i = 1; i < v.length; i++) {
        // console.log('shatter', v[i], 'flag', flag)
        queue.enq({v: [v[i]], flag})
      }
    }

    const t = v[0]
    const containingTxn = rawFindEntryContaining(cg, t)

    // I want an inclusive iterator :p
    const txnStart = containingTxn.version
    let end = t + 1

    // Consume all other changes within this txn.
    while (true) {
      if (queue.isEmpty()) {
        return [end - 1]
      } else {
        const {v: peekV, flag: peekFlag} = queue.peek()
        // console.log('inner peek', peekV, (queue as any)._elements)

        if (peekV.length >= 1 && peekV[0] >= txnStart) {
          // The next item is within this txn. Consume it.
          queue.deq()
          // console.log('inner deq', peekV, peekFlag)

          const peekLast = peekV[0]

          // Only emit inner items when they aren't duplicates.
          if (peekLast + 1 < end) {
            // +1 because we don't want to include the actual merge point in the returned set.
            visit([peekLast + 1, end], flag)
            end = peekLast + 1
          }

          if (peekFlag !== flag) flag = DiffFlag.Shared

          if (peekV.length > 1) {
            // We've run into a merged item which uses part of this entry.
            // We've already pushed the necessary span to the result. Do the
            // normal merge & shatter logic with this item next.
            for (let i = 1; i < peekV.length; i++) {
              // console.log('shatter inner', peekV[i], 'flag', peekFlag)

              queue.enq({v: [peekV[i]], flag: peekFlag})
            }
          }
        } else {
          // Emit the remainder of this txn.
          // console.log('processed txn', txnStart, end, 'flag', flag, 'parents', containingTxn.parents)
          visit([txnStart, end], flag)

          queue.enq(pointFromVersions(containingTxn.parents, flag))
          break
        }
      }
    }
  }
}

/**
 * Two versions have one of 4 different relationship configurations:
 * - They're equal (a == b)
 * - They're concurrent (a || b)
 * - Or one dominates the other (a < b or b > a).
 *
 * This method depends on the caller to check if the passed versions are equal
 * (a === b). Otherwise it returns 0 if the operations are concurrent,
 * -1 if a < b or 1 if b > a.
 */
export const compareVersions = (cg: CausalGraph, a: LV, b: LV): number => {
  if (a > b) {
    return versionContainsLV(cg, [a], b) ? -1 : 0
  } else if (a < b) {
    return versionContainsLV(cg, [b], a) ? 1 : 0
  }
  throw new Error('a and b are equal')
}
