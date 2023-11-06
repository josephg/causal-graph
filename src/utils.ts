import { LV } from './types.js'

export const min2 = (a: number, b: number) => a < b ? a : b
export const max2 = (a: number, b: number) => a > b ? a : b
/**
 * Add a span of versions to a version frontier. The parent versions must be
 * (transitively) already included in the existing frontier.
 *
 * vLast is the last version in the new span of versions being added.
*/

export const advanceFrontier = (frontier: LV[], vLast: LV, parents: LV[]): LV[] => {
  // assert(!branchContainsVersion(db, order, branch), 'db already contains version')
  // for (const parent of op.parents) {
  //    assert(branchContainsVersion(db, parent, branch), 'operation in the future')
  // }
  const f = frontier.filter(v => !parents.includes(v))
  f.push(vLast)
  return sortVersions(f)
}/** Sort in ascending order. */

export const sortVersions = (v: LV[]): LV[] => v.sort((a, b) => a - b)

