export interface VersionSummary { [agent: string]: [number, number][]}

export type RawVersion = [agent: string, seq: number]
/** Local version */

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

