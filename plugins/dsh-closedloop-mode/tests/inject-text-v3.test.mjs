/** inject-text v0.3 薄面测例（旧 inject-text.test 十四例的对象件已随讲课撤销——本三例锁薄面合同）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as IT from '../src/inject-text.js'

test('版本真相格式（x.y.z）', () => {
  assert.match(IT.VERSION, /^\d+\.\d+\.\d+$/)
})

test('offReceipt：收口语义在位（账本保留——换代不抹历史）', () => {
  const r = IT.offReceipt()
  assert.ok(r.includes('关闭') && r.includes('V 账本'), '关闭+账本保留双要素')
})

test('薄面合同：导出仅 VERSION/offReceipt（讲课件零复活——键集精确等式）', () => {
  assert.deepEqual(Object.keys(IT).filter((k) => k !== 'default').sort(), ['VERSION', 'offReceipt'])
})
