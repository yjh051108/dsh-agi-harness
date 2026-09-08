/**
 * nudges — 两处降噪（v0.8.34，A 会话案底）
 *
 * 案底读数（会话 62d99f4e：同文件 218 次编辑 p50=152B + 61 张截图 + 9 次回炉 + 5 次「禁止修补冲刺」）：
 *   ① 审美/无机器通道的活被硬翻成数值预言 → 预言必失效 → 回炉 → 重 declare，注意力从「画好」挪到「测准」；
 *   ② 同一个微步连续失败时，引擎只会说「回滚重推」，模型就在原地打磨（每次消耗一个完整回合 ≈ 27 万 token）。
 * 本模块只产「一行提示」，不改任何判定语义。
 */

/** 组内人判项数（纯函数）。 */
export function humanItemCount(group) {
  return (group?.accept || []).filter((x) => String(x).startsWith('人判:')).length
}

/**
 * 声明期提示（纯函数）：目标组含人判项时给一行——感官类结论别写成数值预言。
 * 无组/无人判项 ⇒ 空串（零注入）。
 */
export function aestheticNudge(group) {
  const n = humanItemCount(group)
  if (n === 0) return ''
  return `🖐 本组含 ${n} 条人判项：感官/审美类结论走人判欠据（terminal_check 会挂账等开发者签收），不要写成 predict 数值——` +
    `把「好不好看」硬翻成像素统计只会烧 token 且预言必失效（案底：同文件 218 次微编辑 / 9 次回炉）。`
}

/**
 * 连续失败提示（纯函数）：同一步连续不中 ≥2 次时换话术。
 * 回滚义务不变——只是别在原地打磨。
 */
export function stallHint(failStreak) {
  const n = Number(failStreak)
  if (!Number.isFinite(n) || n < 2) return ''
  return `⚠ 同一步已连续 ${n} 次预言不中——这多半不是精度问题，是方向问题：` +
    `建议放弃这个微步（拆成更粗的一步，或直接推进主线）；回滚义务不变，别在原地打磨。`
}
