#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "请先安装 Node.js 22.12 或更高版本：https://nodejs.org/en/download"
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"; then
  echo "当前 Node.js 版本过低，请升级到 22.12 或更高版本。"
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "首次运行：安装开发依赖并构建工作台…"
  npm install
  npm run build
elif [ ! -d node_modules ]; then
  echo "首次运行：安装本地下载组件…"
  npm install --omit=dev
fi

export DOWNBIT_OPEN_BROWSER=1
echo "Video Provider 即将打开。关闭此窗口即可停止服务。"
npm start
