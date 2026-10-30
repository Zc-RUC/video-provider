@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更高版本：https://nodejs.org/en/download
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm，请重新安装 Node.js。
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 (
  echo 当前 Node.js 版本过低，请升级到 22.12 或更高版本。
  pause
  exit /b 1
)
if not exist dist\index.html (
  echo 首次运行：安装开发依赖并构建工作台…
  call npm install
  if errorlevel 1 goto error
  call npm run build
  if errorlevel 1 goto error
) else if not exist node_modules (
  echo 首次运行：安装本地下载组件…
  call npm install --omit=dev
  if errorlevel 1 goto error
)
set DOWNBIT_OPEN_BROWSER=1
echo Video Provider 即将打开。关闭此窗口即可停止服务。
call npm start
exit /b %errorlevel%
:error
echo 安装或启动失败，请检查网络后重试。
pause
exit /b 1
