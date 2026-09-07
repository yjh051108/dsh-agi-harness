#!/bin/bash
# Build the dsh-engram-relay external plugin: compile src/ → lib/ (JS +
# declarations) with TypeScript, then bundle src/client/ → lib/client.js with
# tsdown. 一次 `npm run build` 产出 host + client 全量产物——这是云仓库
# （git/file 安装）首装不丢 WebUI 注入的前提：client-modules 扫描到
# dsh.client 声明但找不到 lib/client.js 时，整个 __DSH_BOOT__ 注入会失败。
#
# 依赖解析策略（按优先级）：
#   1. 插件自身 node_modules（npm install --legacy-peer-deps 已装全，含 peer）；
#   2. DSH 安装（DSH_CHECKOUT 源码 checkout 或 PATH 上的 dsh npm 全局包）——
#      仅当自身缺失时链接，保持类型版本与运行 DSH 一致。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ═══ 1. 定位 DSH 安装根（多个候选，仅回退用）═══
DSH_ROOTS=()
if [ -n "${DSH_CHECKOUT:-}" ] && [ -d "$DSH_CHECKOUT/packages" ]; then
  DSH_ROOTS+=("$DSH_CHECKOUT")
fi
if command -v dsh >/dev/null 2>&1; then
  SHIM="$(command -v dsh)"
  SHIM_DIR="$(cd "$(dirname "$SHIM")" && pwd)"
  CANDIDATE="$SHIM_DIR/node_modules/@deepseek-ai/dsh"
  if [ -d "$CANDIDATE" ]; then
    DSH_ROOTS+=("$(cd "$CANDIDATE" && pwd)")
  fi
fi
# npm 全局安装（npm i -g @deepseek-ai/dsh）：<global-node_modules>/@deepseek-ai/dsh
if command -v npm >/dev/null 2>&1; then
  GLOBAL_NM="$(npm root -g 2>/dev/null || true)"
  if [ -n "$GLOBAL_NM" ] && [ -d "$GLOBAL_NM/@deepseek-ai/dsh" ]; then
    DSH_ROOTS+=("$GLOBAL_NM/@deepseek-ai/dsh")
  fi
fi
# Windows 全局 npm 布局兜底（npm 不在 PATH 时）：扫描所有用户的全局包
for candidate in /c/Users/*/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh; do
  if [ -d "$candidate" ]; then
    CAND="$(cd "$candidate" && pwd)"
    case " ${DSH_ROOTS[*]} " in
      *" $CAND "*) ;;
      *) DSH_ROOTS+=("$CAND") ;;
    esac
  fi
done
if [ "${#DSH_ROOTS[@]}" -gt 0 ]; then
  echo "=== DSH 回退根: ${DSH_ROOTS[*]} ==="
else
  echo "=== 未发现 DSH 安装（依赖全部走插件自身 node_modules）==="
fi

# ═══ 2. 依赖确保（自身优先；缺失时从各 DSH 根链接）═══
link_into() { # link_into <link> <target>
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "$1" "$2"
}

ensure_dep() { # ensure_dep <link> <checkout-candidates...>  必需：缺失即失败
  ensure_dep_impl 1 "$@"
}

ensure_dep_opt() { # ensure_dep_opt <link> <checkout-candidates...>  可选：缺失只警告
  ensure_dep_impl 0 "$@"
}

ensure_dep_impl() { # <required 0|1> <link> <checkout-candidates...>
  local required="$1"; shift
  local link="$1"; shift
  if [ -e "node_modules/$link" ]; then
    echo "  dep OK: $link（自身 node_modules）"
    return 0
  fi
  local target=""
  for root in "${DSH_ROOTS[@]}"; do
    if [ -d "$root/packages" ]; then
      # 布局 A：源码 checkout
      for rel in "$@"; do
        if [ -e "$root/$rel" ]; then target="$root/$rel"; break 2; fi
      done
    else
      # 布局 B：npm 全局（node_modules/@deepseek-ai/<name>）
      local name="${link#@deepseek-ai/}"
      if [ "$name" = "$link" ]; then
        if [ -e "$root/node_modules/$link" ]; then target="$root/node_modules/$link"; break; fi
      else
        if [ -e "$root/node_modules/@deepseek-ai/$name" ]; then target="$root/node_modules/@deepseek-ai/$name"; break; fi
      fi
    fi
  done
  if [ -z "$target" ]; then
    if [ "$required" = "1" ]; then
      echo "build: 依赖目标缺失: $link（找过各 DSH 根）——先在插件目录 npm install --legacy-peer-deps" >&2
      exit 1
    fi
    echo "  dep 跳过(可选): $link 未找到——不影响构建（源码未 import）"
    return 0
  fi
  mkdir -p "node_modules/$(dirname "$link")"
  link_into "node_modules/$link" "$target"
  echo "  dep 链接: $link → $target"
}

# 源码 checkout 布局的相对路径（布局 B 在 ensure_dep 内按包名推导）
ensure_dep cordis "vendor/cordis"
ensure_dep schemastery "vendor/schemastery"
ensure_dep @deepseek-ai/dsh-llm "packages/llm/llm"
ensure_dep @deepseek-ai/dsh-system-prompt "packages/core/system-prompt"
ensure_dep @deepseek-ai/dsh-tools "packages/core/tools"
# 以下为历史/传递类型引用（当前源码未 import；可选项，缺了不阻塞）
ensure_dep_opt cosmokit "vendor/cosmokit"
ensure_dep_opt @deepseek-ai/dsh-brand "packages/util/brand"
ensure_dep_opt @deepseek-ai/dsh-compact "packages/compact/compact"
ensure_dep_opt @deepseek-ai/dsh-scope "packages/core/scope"
ensure_dep_opt @deepseek-ai/dsh-session "packages/core/session"
# @standard-schema/spec：仅源码布局的 pnpm store 有；缺失时 skipLibCheck 兜底
if [ ! -e "node_modules/@standard-schema/spec" ]; then
  for root in "${DSH_ROOTS[@]}"; do
    if [ ! -d "$root/node_modules/.pnpm" ]; then continue; fi
    STD_SCHEMA=$(find "$root/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1)
    if [ -n "$STD_SCHEMA" ]; then
      node -e "
        const fs = require('fs');
        const path = require('path');
        fs.rmSync('node_modules/@standard-schema', { recursive: true, force: true });
        fs.mkdirSync('node_modules/@standard-schema', { recursive: true });
        fs.symlinkSync(path.resolve(process.argv[1]), path.resolve('node_modules/@standard-schema/spec'), process.platform === 'win32' ? 'junction' : 'dir');
      " "$STD_SCHEMA/node_modules/@standard-schema/spec"
      break
    fi
  done
fi

# ═══ 3. tsc 定位（优先插件自身 devDep）═══
TSC=""
for candidate in \
  "node_modules/.bin/tsc" \
  "${DSH_ROOTS[0]:-/nonexistent}/node_modules/.bin/tsc" \
  "${DSH_ROOTS[0]:-/nonexistent}/node_modules/typescript/bin/tsc" \
  "node_modules/typescript/bin/tsc"; do
  if [ -n "$candidate" ] && [ -e "$candidate" ]; then TSC="$candidate"; break; fi
done
if [ -z "$TSC" ]; then
  echo "build: 找不到 tsc——在插件目录先跑 npm install（typescript 是 devDependency）" >&2
  exit 1
fi

echo "=== 编译 host（tsc $("$TSC" --version)）==="
"$TSC" -p tsconfig.json

# ═══ 4. client bundle（tsdown；devDep，npm install 后存在）═══
TSDOWN="node_modules/.bin/tsdown"
if [ -e "$TSDOWN" ]; then
  echo "=== 构建 client bundle（tsdown）==="
  "$TSDOWN"
else
  echo "build: 未找到 tsdown——client bundle 未构建（npm install 后重试）" >&2
  exit 1
fi

# ═══ 5. 产物自检（防"首装丢 WebUI 注入"）═══
check() {
  if [ ! -e "$1" ]; then
    echo "build: 产物缺失: $1" >&2
    exit 1
  fi
}
check lib/index.js
check lib/types/index.d.ts
if node -e "const p=require('./package.json'); process.exit(p.dsh?.client?.platform === 'web' ? 0 : 1)"; then
  check lib/client.js
  echo "=== 自检通过：host + client 全量产物就绪 ==="
else
  echo "=== 自检通过：host 产物就绪（无 web client 声明）==="
fi

ls -la lib/ | head -20
