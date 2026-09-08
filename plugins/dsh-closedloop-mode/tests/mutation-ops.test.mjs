/**
 * mutation-ops.test — 算子库自测（算子本身也要被守护：它是测量仪器）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPS_VERSION, OPERATOR_KINDS, deriveMutations, applyMutation, revertMutation } from '../scripts/lib/mutation-ops.mjs'

const SAMPLE = `
export function f(x, list) {
  if (x !== 3 && x >= 1) return true
  const y = list.filter((z) => z > 0).length
  await save(y)
  return false
}
`

test('mo1 派生非空、每条突变可无损还原（可逆性=探针可信的前提）', () => {
  const muts = deriveMutations(SAMPLE, { perKind: 2 })
  assert.ok(muts.length >= 6, `突变数应≥6，实际=${muts.length}`)
  for (const m of muts) {
    const mutated = applyMutation(SAMPLE, m)
    assert.notEqual(mutated, SAMPLE, `${m.kind} 应改变原文`)
    assert.equal(revertMutation(mutated, m), SAMPLE, `${m.kind} 必须可逆`)
  }
})

test('mo2 九类算子齐备且每类都能在样例上产出（无死算子）', () => {
  assert.equal(OPS_VERSION, 'v2')
  assert.equal(OPERATOR_KINDS.length, 9)
  const kinds = new Set(deriveMutations(SAMPLE, { perKind: 2 }).map((m) => m.kind))
  for (const k of OPERATOR_KINDS) assert.ok(kinds.has(k), `算子 ${k} 未产出突变`)
})

test('mo3 跳过注释行（注释里的符号不是实现）', () => {
  const src = '// if (a !== b) return true\nconst v = a !== b\n'
  const muts = deriveMutations(src, { perKind: 3 })
  assert.ok(muts.every((m) => !m.line.startsWith('//')), '不得在注释行派生突变')
  assert.ok(muts.some((m) => m.kind === 'flip-cmp'), '实现行的比较符仍要被派生')
})

test('mo4 突变位置与 from 严格对齐（apply 后局部上下文一致）', () => {
  const muts = deriveMutations(SAMPLE, { perKind: 1 })
  for (const m of muts) {
    assert.equal(SAMPLE.slice(m.at, m.at + m.len), m.from, `${m.kind} 的 at/len 必须框住 from`)
  }
})
