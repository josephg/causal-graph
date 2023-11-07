// *** Tools to syncronize causal graphs ***

import { addPubVersion, findEntryContaining, lvListToPub, nextLV, pubToLV, pubListToLV, clientEntriesForAgent } from "./causal-graph.js"
import { advanceFrontier } from './utils.js'
import { diff } from "./tools.js"
import { CausalGraph, LV, LVRange, PubVersion, tryAppendClientEntry } from "./types.js"
import { min2 } from './utils.js'
import { pushRLEList } from "./rlelist.js"

// *** Serializing the entire causal graph. When serializing the entire thing, we can save local
// versions because the order will be identical on the remote (recieving) end.
//
// There is actually a fancier way to serialize & deserialize which uses this trick even for diffs
// but I haven't implemented it in JS land yet.

// This is identical to CGEntry, but reproduced to pin it.
type SerializedCGEntryV2 = {
  version: LV, // TODO: Remove version here - this is redundant.
  vEnd: LV,

  agent: string,
  seq: number, // Seq for version.

  parents: LV[] // Parents for version
}

export interface SerializedCausalGraphV1 {
  /** TODO: Should probably just recompute the heads on load */
  heads: LV[],
  entries: SerializedCGEntryV2[],
}


export function serialize(cg: CausalGraph): SerializedCausalGraphV1 {
  return {
    heads: cg.heads,
    entries: cg.entries,
  }
}

export function fromSerialized(data: SerializedCausalGraphV1): CausalGraph {
  const cg: CausalGraph = {
    heads: data.heads,
    entries: data.entries,
    agentToVersion: {}
  }

  for (const e of cg.entries) {
    const len = e.vEnd - e.version
    pushRLEList(clientEntriesForAgent(cg, e.agent), {
      seq: e.seq, seqEnd: e.seq + len, version: e.version
    }, tryAppendClientEntry)
  }

  return cg
}


// Parial Serialization. This is a simpler serialization format for deltas.

export type PartialSerializedCGEntry = {
  agent: string,
  seq: number,
  len: number,

  parents: PubVersion[]
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
      const parents: PubVersion[] = offset === 0
        ? lvListToPub(cg, e.parents)
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
    addPubVersion(cg, [agent, seq], len, parents)
  }
  return [start, nextLV(cg)]
}

export function *mergePartialVersions2(cg: CausalGraph, data: PartialSerializedCG) {
  // const start = nextLV(cg)

  for (const {agent, seq, len, parents} of data) {
    const newEntry = addPubVersion(cg, [agent, seq], len, parents)
    if (newEntry != null) yield newEntry
  }

  // return [start, nextLV(cg)]
}

export function advanceVersionFromSerialized(cg: CausalGraph, data: PartialSerializedCG, version: LV[]): LV[] {
  for (const {agent, seq, len, parents} of data) {
    const parentLVs = pubListToLV(cg, parents)
    const vLast = pubToLV(cg, agent, seq + len - 1)
    version = advanceFrontier(version, vLast, parentLVs)
  }

  // NOTE: Callers might need to call findDominators on the result.
  return version
}
