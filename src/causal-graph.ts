// This is a helper library for storing & interacting with a run-length encoded causal graph
// (join semilattice) of changes.
//
// All changes can be referenced as either a [agent, seq] pair or as a "local version" (essentially
// a local, autoincremented ID per known version).
//
// The causal graph only stores a set of known versions and each version's parent version.
// The operations themselves are not stored here.
//
// The versions are is stored in runs, and run-length encoded. Compression depends
// on concurrency. (High concurrency = bad compression. Low concurrency = great compression).

// import bs from './binary-search.js'
import { LV, LVRange, PubVersion, VersionSummary, CausalGraph, ClientEntry, CGEntry, cgEntryRLE, clientEntryRLE, rangeRLE } from './types.js'
import { diff, findDominators } from './tools.js'
import { min2, max2, advanceFrontier } from './utils.js'
import { rleFindEntryOpt, rleInsert, rlePush, rleFindEntry, rleFind, rleIterRangeRaw, rleIterRange } from 'rle-utils'
import { mergePartialVersions3, serializeDiff3 } from './serialization.js'

export const createCG = (): CausalGraph => ({
  heads: [],
  entries: [],
  agentToVersion: {},
})

export const clientEntriesForAgent = (causalGraph: CausalGraph, agent: string): ClientEntry[] => (
  causalGraph.agentToVersion[agent] ??= []
)

// const lastOr = <T, V>(list: T[], f: (t: T) => V, def: V): V => (
//   list.length === 0 ? def : f(list[list.length - 1])
// )

/**
 * Return the next local version to be used in the causal graph.
 *
 * Semantically, this is equivalent in many ways to a "length" function.
 */
export const nextLV = (cg: CausalGraph): LV => (
  cg.entries.length === 0
    ? 0
    : cg.entries[cg.entries.length - 1].vEnd
)
// export const nextLV = (cg: CausalGraph): LV => (
//   lastOr(cg.entries, e => e.vEnd, 0)
// )

/**
 * Return the next available sequence number for the specified agent.
 *
 * If there are holes, this will skip the hole. Eg, if we know about
 * sequence numbers 0-9 and 10-19, this method will return 20, not 10.
 */
export const nextSeqForAgent = (cg: CausalGraph, agent: string): number => {
  const entries = cg.agentToVersion[agent]
  return entries == null
    ? 0
    : entries[entries.length - 1].seqEnd
}

const findClientEntryRaw = (cg: CausalGraph, agent: string, seq: number): ClientEntry | null => {
  const av = cg.agentToVersion[agent]
  if (av == null) return null

  return rleFindEntryOpt(av, clientEntryRLE, seq)
}

export const findClientEntry = (cg: CausalGraph, agent: string, seq: number): [ClientEntry, number] | null => {
  const clientEntry = findClientEntryRaw(cg, agent, seq)
  return clientEntry == null ? null : [clientEntry, seq - clientEntry.seq]

  // Equivalent to:
  // rleFindEntry(av, clientEntryRLE, seq)
}

export const findClientEntryTrimmed = (cg: CausalGraph, agent: string, seq: number): ClientEntry | null => {
  const clientEntry = findClientEntryRaw(cg, agent, seq)
  if (clientEntry == null) return null

  const offset = seq - clientEntry.seq // Not using findClientEntry to avoid an allocation.
  return offset === 0 ? clientEntry : {
    seq,
    seqEnd: clientEntry.seqEnd,
    version: clientEntry.version + offset
  }
}

export const hasPubVersion = (cg: CausalGraph, agent: string, seq: number): boolean => (
  findClientEntryRaw(cg, agent, seq) != null
)

// export const addLocal = (cg: CausalGraph, id: RawVersion, len: number = 1): LV => {
//   return add(cg, id[0], id[1], id[1]+len, cg.version)
// }

/**
 * Add a new version span to the causal graph by specifying its RawVersion (agent, seq)
 * and the RawVersion of its parents.
 *
 * Returns the inserted CGEntry, or null if the span is already included in its entirity
 * in the causal graph.
 */
export const addPubVersion = (cg: CausalGraph, id: PubVersion, len: number = 1, rawParents?: PubVersion[]): CGEntry | null => {
  const parents = rawParents != null
    ? pubListToLV(cg, rawParents)
    : cg.heads

  return add(cg, id[0], id[1], id[1]+len, parents)
}

/**
 * Add an item to the causal graph.
 *
 * Unlike addRawVersion, this method takes parents using LV[].
 *
 * Returns the inserted CGEntry, or null if the span is already included in its entirity
 * in the causal graph.
 */
export const add = (cg: CausalGraph, agent: string, seqStart: number, seqEnd: number, parents: LV[]): CGEntry | null => {
  const version = nextLV(cg)

  while (true) {
    // Look for an equivalent existing entry in the causal graph starting at
    // seq_start. We only add the parts of the that do not already exist in CG.

    // The inserted items will either be the empty set or a range because of version semantics.
    const existingEntry = findClientEntryTrimmed(cg, agent, seqStart)
    // console.log(cg.agentToVersion[agent], seqStart, existingEntry)
    if (existingEntry == null) break // Insert start..end.

    if (existingEntry.seqEnd >= seqEnd) return null // The entire span was already inserted.

    // Or trim and loop.
    seqStart = existingEntry.seqEnd
    parents = [existingEntry.version + (existingEntry.seqEnd - existingEntry.seq) - 1]
  }

  const len = seqEnd - seqStart
  const vEnd = version + len
  const entry: CGEntry = {
    version,
    vEnd,

    agent,
    seq: seqStart,
    parents,
  }

  // The entry list will remain ordered here in standard version order.
  rlePush(cg.entries, cgEntryRLE, entry)
  // But the agent entries may end up out of order, since we might get [b,0] before [b,1] if
  // the same agent modifies two different branches. Hence, insertRLEList instead of pushRLEList.
  rleInsert(
    clientEntriesForAgent(cg, agent),
    clientEntryRLE,
    { seq: seqStart, seqEnd, version },
  )

  cg.heads = advanceFrontier(cg.heads, vEnd - 1, parents)
  return entry
}

// /**
//  * Returns [seq, local version] for the new item (or the first item if num > 1).
//  */
// export const assignLocal = (cg: CausalGraph, agent: string, seq: number, parents: LV[] = cg.heads, num: number = 1): LV => {
//   let version = nextLV(cg)
//   const av = clientEntriesForAgent(cg, agent)
//   const nextValidSeq = lastOr(av, ce => ce.seqEnd, 0)
//   if (seq < nextValidSeq) throw Error('Invalid agent seq')
//   add(cg, agent, seq, seq + num, parents)

//   return version
// }

/**
 * Do a simple lexical comparison of two RawVersions. This is used whenever a tie break
 * is needed.
 *
 * Returns:
 *
 * - Negative if v1 < v2
 * - 0 if the versions are equal
 * - Positive if v1 > v2
 */
export const pubVersionCmp = ([a1, s1]: PubVersion, [a2, s2]: PubVersion) => (
  a1 < a2 ? -1
    : a1 > a2 ? 1
    : s1 - s2
)

/** Same as pubVersionCmp but versions are passed as LVs instead of RawVersions. */
export const lvCmp = (cg: CausalGraph, a: LV, b: LV) => (
  pubVersionCmp(lvToPub(cg, a), lvToPub(cg, b))
)

export const rawFindEntryContaining = (cg: CausalGraph, v: LV): CGEntry => {
  return rleFindEntry(cg.entries, cgEntryRLE, v)
}

export const findEntryContaining = (cg: CausalGraph, v: LV): [CGEntry, number] => {
  return rleFind(cg.entries, cgEntryRLE, v)
}

export const lvToPubWithParents = (cg: CausalGraph, v: LV): [string, number, LV[]] => {
  const [e, offset] = findEntryContaining(cg, v)
  const parents = offset === 0 ? e.parents : [v-1]
  return [e.agent, e.seq + offset, parents]
}

export const lvToPub = (cg: CausalGraph, v: LV): PubVersion => {
  const [e, offset] = findEntryContaining(cg, v)
  return [e.agent, e.seq + offset]
  // causalGraph.entries[localIndex]
}

export const lvListToPub = (cg: CausalGraph, lvList: LV[] = cg.heads): PubVersion[] => (
  lvList.map(v => lvToPub(cg, v))
)


// export const getParents = (cg: CausalGraph, v: LV): LV[] => (
//   localVersionToRaw(cg, v)[2]
// )

export const tryPubToLV = (cg: CausalGraph, agent: string, seq: number): LV | null => {
  // This is pretty inefficient.
  const clientEntry = findClientEntryTrimmed(cg, agent, seq)
  return clientEntry?.version ?? null
}
export const pubToLV = (cg: CausalGraph, agent: string, seq: number): LV => {
  const clientEntry = findClientEntryTrimmed(cg, agent, seq)
  if (clientEntry == null) throw Error(`Unknown ID: (${agent}, ${seq})`)
  return clientEntry.version
}
export const pubToLV2 = (cg: CausalGraph, v: PubVersion): LV => (
  pubToLV(cg, v[0], v[1])
)

export const pubListToLV = (cg: CausalGraph, parents: PubVersion[]): LV[] => (
  parents.map(([agent, seq]) => pubToLV(cg, agent, seq))
)

/**
 * Finds and returns the longest contiguous span of local versions which starts with
 * the specified public version.
 *
 * Returns LV at start and end of the span.
 */
export const pubToLVSpan = (cg: CausalGraph, agent: string, seq: number): [LV, LV] => {
// export const rawToLVSpan = (cg: CausalGraph, agent: string, seq: number): [LV, number] => {
  const e = findClientEntry(cg, agent, seq)
  if (e == null) throw Error(`Unknown ID: (${agent}, ${seq})`)
  const [entry, offset] = e

  return [entry.version + offset, entry.seqEnd - entry.seq + entry.version] // [start, end]
  // return [entry.version + offset, entry.seqEnd - entry.seq - offset] // [start, len].
}

/**
 * Creates a VersionSummary (essentially a vector clock) of the versions known within this
 * causal graph.
 */
export const summarizeVersion = (cg: CausalGraph): VersionSummary => {
  const result: VersionSummary = {}
  for (const k in cg.agentToVersion) {
    const av = cg.agentToVersion[k]
    if (av.length === 0) continue

    const versions: [number, number][] = []
    for (const ce of av) {
      rlePush(versions, rangeRLE, [ce.seq, ce.seqEnd])
    }

    result[k] = versions
  }
  return result
}

const eachVersionBetween = (cg: CausalGraph, vStart: LV, vEnd: LV, visit: (e: CGEntry, vs: number, ve: number) => void) => {
  for (const entry of rleIterRangeRaw(cg.entries, cgEntryRLE, vStart, vEnd)) {
    visit(entry, max2(vStart, entry.version), min2(vEnd, entry.vEnd))
  }
}

// Same as above, but as a generator. And generating a new CGEntry when we yield.
export function *iterVersionsBetween(cg: CausalGraph, vStart: LV, vEnd: LV): Generator<CGEntry> {
  return rleIterRange(cg.entries, cgEntryRLE, vStart, vEnd)
}

// interface VisitEntry {
//   entry: CGEntry,
//   vStart: LV,
//   vEnd: LV,
// }

// export function *iterVersionsBetween(cg: CausalGraph, vStart: LV, vEnd: LV): Generator<VisitEntry> {
//   let idx = bs(cg.entries, vStart, (entry, needle) => (
//     needle < entry.version ? 1
//     : needle >= entry.vEnd ? -1
//     : 0
//   ))
//   if (idx < 0) throw Error('Invalid or missing version: ' + vStart)

//   for (; idx < cg.entries.length; idx++) {
//     const entry = cg.entries[idx]
//     if (entry.version >= vEnd) break

//     // const offset = max2(vStart - entry.version, 0)
//     yield {
//       entry,
//       vStart: max2(vStart, entry.version),
//       vEnd: min2(vEnd, entry.vEnd)
//     }
//   }
// }

/** version is -1 when the seq does not overlap. Each yield is guaranteed to be a version run. */
type IntersectVisitor = (agent: string, startSeq: number, endSeq: number, version: number) => void

/**
 * Scan the VersionSummary and report (via visitor function) which versions overlap.
 * 
 * If you consider the venn diagram of versions, there are 3 categories:
 * - a (only known locally)
 * - a+b (common versions)
 * - b (only known remotely)
 * 
 * Currently this method:
 * - Ignores a only. Only a+b or b are yielded via the visitor
 * - For a+b, we yield the local version
 * - For b only, we yield a LV of -1.
 */
const intersectWithSummaryFull = (cg: CausalGraph, summary: VersionSummary, visit: IntersectVisitor) => {
  for (const agent in summary) {
    const clientEntries = cg.agentToVersion[agent]

    for (let [startSeq, endSeq] of summary[agent]) {
      // This is a bit tricky, because a single item in ClientEntry might span multiple
      // entries.

      if (clientEntries != null) { // Else no intersection here.
        for (const ce of rleIterRangeRaw(clientEntries, clientEntryRLE, startSeq, endSeq)) {
          if (ce.seq > startSeq) {
            visit(agent, startSeq, ce.seq, -1)
            startSeq = ce.seq
          }

          const seqOffset = startSeq - ce.seq
          const versionStart = ce.version + seqOffset

          const localSeqEnd = min2(ce.seqEnd, endSeq)

          visit(agent, startSeq, localSeqEnd, versionStart)

          startSeq = localSeqEnd
        }
      }

      // More items known for this agent in the local cg than the remote one.
      if (startSeq < endSeq) visit(agent, startSeq, endSeq, -1)
    }
  }

  // // But if we're visiting the items only we know about, we need to scan all the locally known
  // // agents...
  // for (const agent in cg.agentToVersion) {
  //   if (summary[agent] != null) continue // Already covered above.

  //   const av = cg.agentToVersion[agent]
  //   // if (av.length === 0) continue

  //   // const versions: [number, number][] = []
  //   for (const ce of av) {
  //     visit(agent, ce.seq, ce.seqEnd, -1)
  //   }
  // }
}

/** Yields the intersection (most recent common version) and remainder (if any) */
export const intersectWithSummary = (cg: CausalGraph, summary: VersionSummary, versionsIn: LV[] = []): [LV[], VersionSummary | null] => {
  let remainder: null | VersionSummary = null

  const versions = versionsIn.slice()
  intersectWithSummaryFull(cg, summary, (agent, startSeq, endSeq, versionStart) => {
    if (versionStart >= 0) {
      const versionEnd = versionStart + (endSeq - startSeq)

      // Ok, now we go through everything from versionStart to versionEnd! Wild.
      eachVersionBetween(cg, versionStart, versionEnd, (e, vs, ve) => {
        const vLast = ve - 1
        if (vLast < e.version) throw Error('Invalid state')
        versions.push(vLast)
      })
    } else {
      remainder ??= {}
      const a = (remainder[agent] ??= [])
      a.push([startSeq, endSeq])
    }
  })

  return [findDominators(cg, versions), remainder]
}

/**
 * Merge any missing entries from the source causal graph.
 *
 * This is typically only useful in testing.
 *
 * @returns the list of LV ranges copied over from src.
 */
export function mergeLocalCG(dest: CausalGraph, src: CausalGraph): LVRange[] {
  let vs = summarizeVersion(dest)
  const [commonVersion, _remainder] = intersectWithSummary(src, vs)
  // `remainder` lists items in dest that are not in src. Not relevant!

  // Now we need to get all the versions since commonVersion.
  const ranges = diff(src, commonVersion, src.heads).bOnly

  // Copy the missing CG entries.
  // const oldDiff = serializeDiff(src, ranges)
  // console.log('oldf', oldDiff)
  // mergePartialVersions(dest, oldDiff)

  const cgDiff = serializeDiff3(src, ranges)
  mergePartialVersions3(dest, cgDiff)
  // console.log('diff', cgDiff)
  // console.log('head ->', lvListToPub(dest))

  return ranges
}
