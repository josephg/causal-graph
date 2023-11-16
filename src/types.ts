export interface VersionSummary { [agent: string]: [number, number][]}

/** Public Version (sharable with other peers) */
export type PubVersion = [agent: string, seq: number]

/** Local version. These values generally should never leave this local peer! */
export type LV = number

/** Local version range. Range is [start, end). */
export type LVRange = [start: number, end: number]

export type CGEntry = {
  version: LV
  vEnd: LV // > version.

  agent: string
  seq: number // Seq for version.

  parents: LV[] // Parents for version
}

export type ClientEntry = {
  seq: number
  seqEnd: number
  /** LV of the first item in this run */
  version: LV
}

/**
 * This is the core data structure that this library is built around. The
 * structure stores a run-length encoded list of entries, where each entry
 * maps each local version to:
 *
 * - An [agent, seq] pair (RawVersion)
 * - And a parent version
 *
 * The heads list names the dominator versions of the causal graph. If a
 * new entry is added which comes after all known versions, the heads will
 * be the new entry's parents.
 *
 * And we also store a mapping back from RawVersion to LV for efficient
 * access.
*/
export interface CausalGraph {
  /** Map from localversion -> rawversion */
  entries: CGEntry[]

  /** Current global version frontier */
  heads: LV[]

  /** Map from agent -> list of versions by that agent */
  agentToVersion: { [k: string]: ClientEntry[]}
}

export interface CommonMethods<T> {
  len?(item: T): number,
  cloneItem?(item: T): T,
}

export interface MergeMethods<T> extends CommonMethods<T> {
  // canAppend(into: T, from: T): boolean,
  // append(into: T, from: T): void,

  /**
   * Try and append from to the end of to. Returns true if
   * this is successful. False if not. If this method returns
   * false, the items must not be modified.
   */
  tryAppend(to: T, from: T): boolean,

  // tryPrepend as an optimization.
}

export interface SplitMethods<T> extends CommonMethods<T> {
  /**
   * Offset must be between 1 and item len -1. The item is truncated
   * in-place.
   */
  truncateKeepingLeft(item: T, offset: number): void,
  truncateKeepingRight(item: T, offset: number): void,
  // split?(item: T, offset: number): [T, T],
}

export interface Keyed<T> extends CommonMethods<T> {
  keyStart(item: T): number,
  keyEnd(item: T): number,
}

export type AllRLEMethods<T> = MergeMethods<T> & SplitMethods<T> & Keyed<T>





export const cgEntryRLE: AllRLEMethods<CGEntry> = {
  // len(item) { return item.vEnd - item.version },
  keyStart: e => e.version,
  keyEnd: e => e.vEnd,
  tryAppend(a, b) {
    if (b.version === a.vEnd
      && a.agent === b.agent
      && a.seq + (a.vEnd - a.version) === b.seq
      && b.parents.length === 1 && b.parents[0] === a.vEnd - 1
    ) {
      a.vEnd = b.vEnd
      return true
    } else {
      return false
    }
  },
  truncateKeepingLeft(item, offset) {
    item.vEnd = item.version + offset
  },
  truncateKeepingRight(item, offset) {
    if (offset < 1) throw Error('Invalid offset')
    item.version += offset
    item.seq += offset
    item.parents = [item.version - 1]
  }
}

export const clientEntryRLE: AllRLEMethods<ClientEntry> = {
  // len(item) { return item.seqEnd - item.seq },
  keyStart: e => e.seq,
  keyEnd: e => e.seqEnd,
  tryAppend(a, b) {
    const canAppend = b.seq === a.seqEnd
      && b.version === (a.version + (a.seqEnd - a.seq))

    if (canAppend) {
      a.seqEnd = b.seqEnd
    }
    return canAppend
  },
  truncateKeepingLeft(item, offset) {
    item.seqEnd = item.seq + offset
  },
  truncateKeepingRight(item, offset) {
    item.seq += offset
    item.version += offset
  }
}


// // RLE append for CGEntry and ClientEntry.
// export const tryAppendEntries = (a: CGEntry, b: CGEntry): boolean => {
//   const canAppend = b.version === a.vEnd
//     && a.agent === b.agent
//     && a.seq + (a.vEnd - a.version) === b.seq
//     && b.parents.length === 1 && b.parents[0] === a.vEnd - 1

//   if (canAppend) {
//     a.vEnd = b.vEnd
//   }

//   return canAppend
// }

// export const tryAppendClientEntry = (a: ClientEntry, b: ClientEntry): boolean => {
//   const canAppend = b.seq === a.seqEnd
//     && b.version === (a.version + (a.seqEnd - a.seq))

//   if (canAppend) {
//     a.seqEnd = b.seqEnd
//   }
//   return canAppend
// }
