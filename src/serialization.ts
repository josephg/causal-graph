// *** Tools to syncronize causal graphs ***

import { addPubVersion, findEntryContaining, lvListToPub, nextLV, pubToLV, pubListToLV, clientEntriesForAgent, createCG, lvToPub, pubToLV2, add } from "./causal-graph.js"
import { advanceFrontier } from './utils.js'
import { diff } from "./tools.js"
import { CGEntry, CausalGraph, LV, LVRange, PubVersion, clientEntryRLE } from "./types.js"
import { min2 } from './utils.js'
import { rleInsert } from "./rlelist.js"
import binarySearch from './binary-search.js'

// *** Serializing the entire causal graph. When serializing the entire thing, we can save local
// versions because the order will be identical on the remote (recieving) end.
//
// There is actually a fancier way to serialize & deserialize which uses this trick even for diffs
// but I haven't implemented it in JS land yet.

// This is identical to CGEntry, but reproduced to pin it.
type SerializedCGEntryV3 = {
  // version: LV, // TODO: Remove version here - this is redundant.
  // vEnd: LV,

  agent: string,
  seq: number, // Seq for version.
  len: number,
  
  parents: LV[] // Parents for version
}

export type SerializedCausalGraphV2 = SerializedCGEntryV3[]

// export interface SerializedCausalGraphV2 {
//   /** TODO: Should probably just recompute the heads on load */
//   heads: LV[],
//   entries: SerializedCGEntryV2[],
// }


export function serialize(cg: CausalGraph): SerializedCausalGraphV2 {
  return cg.entries.map(e => ({
    agent: e.agent,
    seq: e.seq,
    len: e.vEnd - e.version,
    parents: e.parents,
  }))
}

export function fromSerialized(data: SerializedCausalGraphV2): CausalGraph {
  const result = createCG()

  let v = 0
  for (const e of data) {
    result.entries.push({
      agent: e.agent,
      seq: e.seq,
      version: v,
      vEnd: v + e.len,
      parents: e.parents,
    })

    rleInsert(
      clientEntriesForAgent(result, e.agent),
      clientEntryRLE,
      {
        seq: e.seq,
        seqEnd: e.seq + e.len,
        version: v
      }
    )

    result.heads = advanceFrontier(result.heads, v + e.len - 1, e.parents)

    v += e.len
  }

  return result
}

export function genOffsets(entries: {len: number}[]): number[] {
  let o = 0
  const offsets: number[] = []
  for (const e of entries) {
    offsets.push(o)
    o += e.len
  }
  return offsets
}

// Parial Serialization. This is a simple serialization format for deltas.
export type PartialSerializedCGEntry = {
  agent: string,
  seq: number,
  len: number,
  parents: PubVersion[]
}

export type PartialSerializedV2 = PartialSerializedCGEntry[]

/**
 * The entries returned from this function are in the order of versions
 * specified in ranges.
 */
export function serializeDiff(cg: CausalGraph, ranges: LVRange[]): PartialSerializedV2 {
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
export function serializeFromVersion(cg: CausalGraph, v: LV[]): PartialSerializedV2 {
  const ranges = diff(cg, v, cg.heads).bOnly
  return serializeDiff(cg, ranges)
}

export function mergePartialVersions(cg: CausalGraph, data: PartialSerializedV2): LVRange {
  const start = nextLV(cg)

  for (const {agent, seq, len, parents} of data) {
    addPubVersion(cg, [agent, seq], len, parents)
  }
  return [start, nextLV(cg)]
}

export function *mergePartialVersionsIter(cg: CausalGraph, data: PartialSerializedV2): Generator<CGEntry> {
  // const start = nextLV(cg)

  for (const {agent, seq, len, parents} of data) {
    const newEntry = addPubVersion(cg, [agent, seq], len, parents)
    if (newEntry != null) yield newEntry
  }

  // return [start, nextLV(cg)]
}

export function advanceVersionFromSerialized(cg: CausalGraph, data: PartialSerializedV2, version: LV[]): LV[] {
  for (const {agent, seq, len, parents} of data) {
    const parentLVs = pubListToLV(cg, parents)
    const vLast = pubToLV(cg, agent, seq + len - 1)
    version = advanceFrontier(version, vLast, parentLVs)
  }

  // NOTE: Callers might need to call findDominators on the result.
  return version
}

export function diffOffsetToLV2(offset: number, data: PartialSerializedV2, entryOffsets: number[], inCg: CausalGraph): LV {
  // Find the version in the data we've already extracted.
  const idx = binarySearch(entryOffsets, offset, (offset, needle, index) => (
    needle < offset ? 1
    : needle >= offset + data[index].len ? -1
    : 0
  ))

  // console.log('i', idx, offsetOfEntry, p, data.entries)
  if (idx < 0) throw Error('Could not find parent item')
  const e = data[idx]
  return pubToLV(inCg, e.agent, e.seq + offset - entryOffsets[idx])
}

/**
 * This is a newer API for serializing diffs. There are two nice things about this format:
 *
 * 1. This format stores the same data, in the same data format when doing snapshots of
 *    the entire causal graph. (When snapshotting a full graph, extRef is empty).
 * 2. The format is much more compact than the simpler partial serialization format above.
 *
 * But I don't know if the extra complexity is worth using generally.
 */
export interface PartialSerializedV3 {
  extRef: PubVersion[],
  entries: SerializedCGEntryV3[],
}

/**
 * The entries returned from this function are in the order of versions
 * specified in ranges.
 */
export function serializeDiff3(cg: CausalGraph, ranges: LVRange[]): PartialSerializedV3 {
  const result: PartialSerializedV3 = {
    extRef: [],
    entries: [],
  }

  let outOffset = 0
  const offsetOfRangeStart: number[] = []
  for (let [start, end] of ranges) {
    offsetOfRangeStart.push(outOffset)
    outOffset += end - start

    while (start != end) {
      const [e, offset] = findEntryContaining(cg, start)

      const localEnd = min2(end, e.vEnd)
      const len = localEnd - start
      const localParents: LV[] = offset > 0
        ? [e.version + offset - 1]
        : e.parents

      // The parents we output here are either 0+ - in which case the
      // number represents an offset within the data we're serializing.
      // Or negative - in which case its the 2s compliment of an index
      // in extRef.
      const outParents: number[] = localParents.map(p => {
        const idx = binarySearch(ranges, p, ([start, end], needle) => (
          needle < start ? 1
          : needle >= end ? -1
          : 0
        ))

        return idx >= 0
          ? offsetOfRangeStart[idx] + p - ranges[idx][0]
          // push returns the new length. Thus this is -idx-1.
          : -result.extRef.push(lvToPub(cg, p))
      })

      result.entries.push({
        agent: e.agent,
        seq: e.seq + offset,
        len,
        parents: outParents
      })

      start += len
    }
  }

  return result
}

export function serializeFromVersion3(cg: CausalGraph, v: LV[]): PartialSerializedV3 {
  const ranges = diff(cg, v, cg.heads).bOnly
  return serializeDiff3(cg, ranges)
}

export function diffOffsetToLV3(offset: number, data: PartialSerializedV3, entryOffsets: number[], inCg: CausalGraph): LV {
  if (offset < 0) return pubToLV2(inCg, data.extRef[-offset-1])
  else {
    // Find the version in the data we've already extracted.
    const idx = binarySearch(entryOffsets, offset, (offset, needle, index) => (
      needle < offset ? 1
        : needle >= offset + data.entries[index!].len ? -1
        : 0
    ))

    // console.log('i', idx, offsetOfEntry, p, data.entries)
    if (idx < 0) throw Error('Could not find parent item')
    const e = data.entries[idx]
    // console.log('pubToLV', e.agent, e.seq + offset - entryOffsets[idx])
    return pubToLV(inCg, e.agent, e.seq + offset - entryOffsets[idx])
  }
}

export function *mergePartialVersionsIter3(cg: CausalGraph, data: PartialSerializedV3): Generator<CGEntry, number[]> {
  // const start = nextLV(cg)

  let offset = 0
  // Array has an entry for each of data.entries, with the serialized version offset.
  const entryOffsets: number[] = []

  for (const {agent, seq, len, parents} of data.entries) {
    // console.log('entry', {agent, seq, len, parents})

    // The parents are specified using simple integers. 0+ means a version relative
    // to the versions within this snapshot. Negative means we look up the pub version
    // in refs.
    const localParents: LV[] = parents.map(p => diffOffsetToLV3(p, data, entryOffsets, cg))

    // console.log('addPubVersion', [agent, seq], len, localParents, parents, data.extRef)
    // console.log('addPubVersion', [agent, seq], 'len', len, 'parents', localParents)
    const newEntry = add(cg, agent, seq, seq + len, localParents)
    if (newEntry != null) yield newEntry

    entryOffsets.push(offset)
    offset += len
  }

  return entryOffsets
}

/** Returns the offset of each entry. */
export function mergePartialVersions3(cg: CausalGraph, data: PartialSerializedV3): number[] {
  // This function is awkward so we can throw away the new entries.
  // TODO: Consider refactoring this to not use generators.
  const iter = mergePartialVersionsIter3(cg, data)
  let entry
  while (!(entry = iter.next()).done);
  return entry.value
}

export function advanceVersionFromSerialized3(cg: CausalGraph, data: PartialSerializedV3, version: LV[]): LV[] {
  // Gross.
  let offset = 0
  const entryOffsets: number[] = []
  for (const e of data.entries) {
    entryOffsets.push(offset)
    offset += e.len
  }

  for (const {agent, seq, len, parents} of data.entries) {
    const parentLVs = parents.map(p => diffOffsetToLV3(p, data, entryOffsets, cg))
    // const parentLVs = pubListToLV(cg, parents)
    const vLast = pubToLV(cg, agent, seq + len - 1)
    version = advanceFrontier(version, vLast, parentLVs)
  }

  // NOTE: Callers might need to call findDominators on the result.
  return version
}
