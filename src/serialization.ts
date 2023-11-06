// *** Tools to syncronize causal graphs ***

import { addRawVersion, findEntryContaining, lvToRawList, nextLV, rawToLV, rawToLVList } from "./causal-graph.js"
import { advanceFrontier } from './utils.js'
import { diff } from "./tools.js"
import { CausalGraph, LV, LVRange, RawVersion } from "./types.js"
import { min2, max2 } from './utils.js'

type PartialSerializedCGEntry = {
  agent: string,
  seq: number,
  len: number,

  parents: RawVersion[]
}

export type PartialSerializedCG = PartialSerializedCGEntry[]

/**
 * The entries returned from this function are in the order of versions
 * specified in ranges.
 */
export function serializeDiff(cg: CausalGraph, ranges: LVRange[]): PartialSerializedCG {
  const entries: PartialSerializedCGEntry[] = []
  for (let [start, end] of ranges) {
    while (start != end) {
      const [e, offset] = findEntryContaining(cg, start)

      const localEnd = min2(end, e.vEnd)
      const len = localEnd - start
      const parents: RawVersion[] = offset === 0
        ? lvToRawList(cg, e.parents)
        : [[e.agent, e.seq + offset - 1]]

      entries.push({
        agent: e.agent,
        seq: e.seq + offset,
        len,
        parents
      })

      start += len
    }
  }

  return entries
}

//! The entries returned from this function are always in causal order.
export function serializeFromVersion(cg: CausalGraph, v: LV[]): PartialSerializedCG {
  const ranges = diff(cg, v, cg.heads).bOnly
  return serializeDiff(cg, ranges)
}

export function mergePartialVersions(cg: CausalGraph, data: PartialSerializedCG): LVRange {
  const start = nextLV(cg)

  for (const {agent, seq, len, parents} of data) {
    addRawVersion(cg, [agent, seq], len, parents)
  }
  return [start, nextLV(cg)]
}

export function *mergePartialVersions2(cg: CausalGraph, data: PartialSerializedCG) {
  // const start = nextLV(cg)

  for (const {agent, seq, len, parents} of data) {
    const newEntry = addRawVersion(cg, [agent, seq], len, parents)
    if (newEntry != null) yield newEntry
  }

  // return [start, nextLV(cg)]
}

export function advanceVersionFromSerialized(cg: CausalGraph, data: PartialSerializedCG, version: LV[]): LV[] {
  for (const {agent, seq, len, parents} of data) {
    const parentLVs = rawToLVList(cg, parents)
    const vLast = rawToLV(cg, agent, seq + len - 1)
    version = advanceFrontier(version, vLast, parentLVs)
  }

  // NOTE: Callers might need to call findDominators on the result.
  return version
}
