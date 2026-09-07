/** CSS Modules 类型声明（tsdown 的 css-inline 构建期编译）。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
