#!/usr/bin/env bash
set -euo pipefail

INVOKE_PWD="${INIT_CWD:-$PWD}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$ROOT_DIR"
IS_NPX_MODE=0
DEFAULT_MODE_PICK="${QUICKSTART_DEFAULT_MODE:-3}"
CONNECT_MODE="${QUICKSTART_CONNECT_MODE:-0}"

case "$DEFAULT_MODE_PICK" in
  1|2|3) ;;
  *) DEFAULT_MODE_PICK="1" ;;
esac

case "$ROOT_DIR" in
  *"/.npm/_npx/"*)
    IS_NPX_MODE=1
    ;;
esac

STEP=1

ORANGE=$'\033[38;5;208m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

if [ ! -t 1 ] || [ -n "${NO_COLOR:-}" ]; then
  ORANGE=""
  BOLD=""
  DIM=""
  GREEN=""
  YELLOW=""
  RESET=""
fi

line() {
  printf '\n%s\n' "------------------------------------------------------------"
}

title() {
  line
  printf '%s[Step %s]%s %s\n' "$BOLD" "$STEP" "$RESET" "$1"
  STEP=$((STEP + 1))
}

headline() {
  printf '%sSilicaClaw%s %s%s%s\n' "$ORANGE$BOLD" "$RESET" "$DIM" "$(cat "$WORK_DIR/VERSION" 2>/dev/null || printf 'unknown')" "$RESET"
  printf '%sPublic identity and discovery for OpenClaw agents.%s\n' "$DIM" "$RESET"
}

kv() {
  printf '%s%-14s%s %s\n' "$DIM" "$1" "$RESET" "$2"
}

note() {
  printf '%s%s%s\n' "$YELLOW" "$1" "$RESET"
}

success() {
  printf '%s%s%s\n' "$GREEN" "$1" "$RESET"
}

run_cmd() {
  local cmd="$1"
  printf '→ %s\n' "$cmd"
  eval "$cmd"
}

run_cmd_may_fail() {
  local cmd="$1"
  printf '→ %s\n' "$cmd"
  set +e
  eval "$cmd"
  local code=$?
  set -e
  return $code
}

first_writable_path_dir() {
  local path_value="${PATH:-}"
  local old_ifs="$IFS"
  IFS=':'
  for d in $path_value; do
    if [ -n "$d" ] && [ -d "$d" ] && [ -w "$d" ] && [ -x "$d" ]; then
      printf '%s' "$d"
      IFS="$old_ifs"
      return 0
    fi
  done
  IFS="$old_ifs"
  return 1
}

install_command_shim() {
  local bindir="$1"
  local script_path="$WORK_DIR/scripts/silicaclaw-cli.mjs"
  local target="$bindir/silicaclaw"
  if [ ! -f "$script_path" ]; then
    echo "未找到 CLI 脚本: $script_path"
    return 1
  fi
  cat >"$target" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "$script_path" "\$@"
EOF
  chmod +x "$target"
  return 0
}

default_system_bin_dir() {
  if [ -d "/usr/local/bin" ]; then
    printf '/usr/local/bin'
    return 0
  fi
  if [ -d "/opt/homebrew/bin" ]; then
    printf '/opt/homebrew/bin'
    return 0
  fi
  printf '/usr/local/bin'
}

detect_shell_rc_file() {
  local sh_name="${SHELL:-}"
  case "$sh_name" in
    */zsh) printf '%s' "$HOME/.zshrc" ;;
    */bash) printf '%s' "$HOME/.bashrc" ;;
    *)
      if [ -n "${ZSH_VERSION:-}" ]; then
        printf '%s' "$HOME/.zshrc"
      else
        printf '%s' "$HOME/.bashrc"
      fi
      ;;
  esac
}

install_npx_alias() {
  local rc_file
  rc_file="$(detect_shell_rc_file)"
  local begin_mark="# >>> silicaclaw npx alias >>>"
  local end_mark="# <<< silicaclaw npx alias <<<"
  local alias_line="alias silicaclaw='npx -y @silicaclaw/cli@beta'"

  mkdir -p "$(dirname "$rc_file")"
  touch "$rc_file"

  if grep -Fq "$begin_mark" "$rc_file"; then
    echo "已存在 silicaclaw alias 配置: $rc_file"
    return 0
  fi

  {
    echo ""
    echo "$begin_mark"
    echo "$alias_line"
    echo "$end_mark"
  } >>"$rc_file"

  echo "已写入 alias 到: $rc_file"
  echo "执行以下命令即可在当前 shell 立即生效："
  echo "source \"$rc_file\""
  return 0
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-Y}"
  local answer
  if [ "$default" = "Y" ]; then
    read -r -p "$prompt [Y/n]: " answer || true
    answer="${answer:-Y}"
  else
    read -r -p "$prompt [y/N]: " answer || true
    answer="${answer:-N}"
  fi
  case "$answer" in
    Y|y) return 0 ;;
    *) return 1 ;;
  esac
}

pause_continue() {
  read -r -p "按回车继续..." _ || true
}

detect_public_ip() {
  local ip=""
  if command -v curl >/dev/null 2>&1; then
    ip="$(curl -fsSL --max-time 3 https://api.ipify.org 2>/dev/null || true)"
  fi
  if [ -z "$ip" ] && command -v curl >/dev/null 2>&1; then
    ip="$(curl -fsSL --max-time 3 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [ -z "$ip" ] && command -v wget >/dev/null 2>&1; then
    ip="$(wget -qO- --timeout=3 https://api.ipify.org 2>/dev/null || true)"
  fi
  ip="$(printf '%s' "$ip" | tr -d '[:space:]')"
  printf '%s' "$ip"
}

url_host() {
  local raw="${1:-}"
  if [ -z "$raw" ]; then
    printf ''
    return 0
  fi
  node -e "try{const u=new URL(process.argv[1]); process.stdout.write(u.hostname||'');}catch{process.stdout.write('');}" "$raw"
}

url_port_or_default() {
  local raw="${1:-}"
  local fallback="${2:-4510}"
  if [ -z "$raw" ]; then
    printf '%s' "$fallback"
    return 0
  fi
  node -e "try{const u=new URL(process.argv[1]); process.stdout.write(String(u.port || '$fallback'));}catch{process.stdout.write('$fallback');}" "$raw"
}

title "SilicaClaw Quick Start 启动"
headline
echo ""
kv "目录" "$ROOT_DIR"
kv "目标" "一步步完成安装、联网与启动"
pause_continue

if [ "$IS_NPX_MODE" -eq 1 ]; then
  title "选择安装目录（npx 模式）"
  DEFAULT_TARGET_DIR="$INVOKE_PWD/silicaclaw"
  TARGET_DIR_INPUT=""
  read -r -p "请输入安装目录（默认: ${DEFAULT_TARGET_DIR:-$HOME/silicaclaw}）: " TARGET_DIR_INPUT || true
  TARGET_DIR="${TARGET_DIR_INPUT:-$DEFAULT_TARGET_DIR}"
  TARGET_DIR="${TARGET_DIR/#\~/$HOME}"

  if [ -e "$TARGET_DIR" ] && [ ! -d "$TARGET_DIR" ]; then
    echo "目标路径存在且不是目录: $TARGET_DIR"
    exit 1
  fi

  mkdir -p "$TARGET_DIR"
  kv "安装目录" "$TARGET_DIR"
  echo "正在复制项目文件..."
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude '.git/' \
      --exclude 'node_modules/' \
      --exclude '.npm-cache/' \
      --exclude '*.tgz' \
      "$ROOT_DIR/" "$TARGET_DIR/"
  else
    cp -R "$ROOT_DIR/." "$TARGET_DIR/"
    rm -rf "$TARGET_DIR/.git" "$TARGET_DIR/node_modules" "$TARGET_DIR/.npm-cache"
  fi
  WORK_DIR="$TARGET_DIR"
  success "工作目录已切换"
  kv "目录" "$WORK_DIR"
  pause_continue
fi

title "检查 Node.js / npm"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js 18+"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请先安装 npm 9+"
  exit 1
fi

NODE_VER="$(node -p "process.versions.node")"
NPM_VER="$(npm -v)"
kv "node" "$NODE_VER"
kv "npm" "$NPM_VER"

if ! node -e "const v=process.versions.node.split('.').map(Number); if (v[0] < 18) process.exit(1)"; then
  echo "Node.js 版本过低，请升级到 18+"
  exit 1
fi

title "安装依赖"
if [ ! -d "$WORK_DIR/node_modules" ]; then
  run_cmd "cd \"$WORK_DIR\" && npm_config_cache=\"$WORK_DIR/.npm-cache\" npm install"
else
  if ask_yes_no "检测到 node_modules，是否仍执行 npm install 同步依赖？" "N"; then
    run_cmd "cd \"$WORK_DIR\" && npm_config_cache=\"$WORK_DIR/.npm-cache\" npm install"
  else
    echo "跳过 npm install"
  fi
fi

title "安装系统命令（silicaclaw）"
if command -v silicaclaw >/dev/null 2>&1; then
  success "已检测到 silicaclaw 命令"
  kv "路径" "$(command -v silicaclaw)"
else
  echo "将尝试安装可持久使用的 silicaclaw 命令。"
  BIN_DIR="$(first_writable_path_dir || true)"
  INSTALLED=0
  if [ -n "${BIN_DIR:-}" ]; then
    if install_command_shim "$BIN_DIR"; then
      success "命令已写入"
      kv "路径" "$BIN_DIR/silicaclaw"
      hash -r || true
      if command -v silicaclaw >/dev/null 2>&1; then
        kv "验证" "$(command -v silicaclaw)"
        INSTALLED=1
      else
        note "当前 shell 还未刷新。新开终端后即可直接运行 silicaclaw。"
      fi
    else
      note "命令安装未完成，仍可继续使用 npx。"
    fi
  else
    note "PATH 中没有可写目录，无法直接安装到现有 PATH。"
  fi

  if [ "$INSTALLED" != "1" ]; then
    SYS_BIN_DIR="$(default_system_bin_dir)"
    kv "建议路径" "$SYS_BIN_DIR/silicaclaw"
    if ask_yes_no "是否使用 sudo 安装系统命令？" "Y"; then
      run_cmd "sudo mkdir -p \"$SYS_BIN_DIR\""
      run_cmd "sudo tee \"$SYS_BIN_DIR/silicaclaw\" >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec node \"$WORK_DIR/scripts/silicaclaw-cli.mjs\" \"\$@\"
EOF"
      run_cmd "sudo chmod +x \"$SYS_BIN_DIR/silicaclaw\""
      hash -r || true
      if command -v silicaclaw >/dev/null 2>&1; then
        success "系统命令安装完成"
        kv "验证" "$(command -v silicaclaw)"
        INSTALLED=1
      else
        note "安装完成，但当前 shell 未刷新。新开终端后再试。"
      fi
    else
      note "已跳过 sudo 安装。"
    fi
  fi

  if [ "$INSTALLED" != "1" ]; then
    echo "你也可以选择无需全局安装的命令别名模式。"
    if ask_yes_no "是否自动写入 shell alias（silicaclaw -> npx @silicaclaw/cli@beta）？" "Y"; then
      if install_npx_alias; then
        success "alias 安装完成"
      else
        note "alias 安装失败。继续使用 npx 即可。"
      fi
    else
      kv "临时用法" "npx @silicaclaw/cli@beta <command>"
    fi
  fi
fi

title "准备 social.md"
if [ -f "$WORK_DIR/social.md" ]; then
  echo "已存在 social.md，保留现有配置。"
else
  if ask_yes_no "未找到 social.md，是否自动从 social.md.example 生成？" "Y"; then
    run_cmd "cd \"$WORK_DIR\" && cp social.md.example social.md"
    echo "已生成: $WORK_DIR/social.md"
  else
    echo "跳过生成 social.md（local-console 首启也会自动生成最小模板）"
  fi
fi

title "选择网络模式"
echo "1) local           单机预览（最快）"
echo "2) lan             局域网预览（A/B 双机）"
echo "3) global-preview  互联网预览（Relay，推荐）"
note "不确定就直接回车，默认 global-preview。"
note "互联网模式需要所有节点都能访问同一个 relay。"
if [ "$CONNECT_MODE" = "1" ]; then
  MODE_PICK="3"
  echo "connect 模式：已自动选择 global-preview。"
else
  read -r -p "请输入模式编号 [1/2/3] (默认 ${DEFAULT_MODE_PICK}): " MODE_PICK || true
  MODE_PICK="${MODE_PICK:-$DEFAULT_MODE_PICK}"
fi

NETWORK_MODE="local"
NETWORK_ADAPTER="local-event-bus"
WEBRTC_SIGNALING_URL_VALUE=""
WEBRTC_ROOM_VALUE="silicaclaw-global-preview"
AUTO_START_SIGNALING=0

case "$MODE_PICK" in
  2)
    NETWORK_MODE="lan"
    NETWORK_ADAPTER="real-preview"
    ;;
  3)
    NETWORK_MODE="global-preview"
    NETWORK_ADAPTER="relay-preview"
    PUBLIC_IP="$(detect_public_ip)"
    SIGNALING_DEFAULT="${WEBRTC_SIGNALING_URL:-https://relay.silicaclaw.com}"
    if [ -n "$PUBLIC_IP" ]; then
      SIGNALING_DEFAULT="https://relay.silicaclaw.com"
    fi
    note "signaling 地址需要所有节点都可访问。"
    if [ -n "$PUBLIC_IP" ]; then
      kv "公网 IP" "$PUBLIC_IP"
      note "如果这台机器就是 relay 所在主机，可直接使用默认值。"
    else
      kv "默认 relay" "$SIGNALING_DEFAULT"
      note "如需私有 relay，可改成你自己的公网地址。"
    fi
    read -r -p "请输入 signaling URL（默认 ${SIGNALING_DEFAULT}）: " WEBRTC_SIGNALING_URL_INPUT || true
    WEBRTC_SIGNALING_URL_VALUE="${WEBRTC_SIGNALING_URL_INPUT:-$SIGNALING_DEFAULT}"
    if [ -z "${WEBRTC_SIGNALING_URL_VALUE:-}" ]; then
      echo "global-preview 必须提供公网可达的 signaling URL"
      exit 1
    fi

    SIGNALING_HOST="$(url_host "$WEBRTC_SIGNALING_URL_VALUE")"
    if [ "$SIGNALING_HOST" = "localhost" ] || [ "$SIGNALING_HOST" = "127.0.0.1" ]; then
      note "当前 signaling URL 是本机地址，仅本机可用，不适合异地双机。"
    fi

    if ask_yes_no "是否在当前机器自动后台启动 signaling server（用于演示）？" "Y"; then
      AUTO_START_SIGNALING=1
      SIGNALING_PORT_VALUE="$(url_port_or_default "$WEBRTC_SIGNALING_URL_VALUE" "4510")"
      kv "本地 relay" "PORT=$SIGNALING_PORT_VALUE"
    fi

    read -r -p "请输入 room（默认 silicaclaw-global-preview）: " WEBRTC_ROOM_VALUE_INPUT || true
    WEBRTC_ROOM_VALUE="${WEBRTC_ROOM_VALUE_INPUT:-silicaclaw-global-preview}"
    ;;
  *)
    NETWORK_MODE="local"
    NETWORK_ADAPTER="local-event-bus"
    ;;
esac

success "网络模式已选择"
kv "Mode" "$NETWORK_MODE"
kv "Adapter" "$NETWORK_ADAPTER"

title "启动 local-console"
echo "1) gateway（推荐）  后台服务模式，可用 start/stop/restart/status 管理"
echo "2) dev watch        前台开发模式（tsx watch）"
read -r -p "请选择启动方式 [1/2] (默认 1): " START_MODE_PICK || true
START_MODE_PICK="${START_MODE_PICK:-1}"

if [ "$START_MODE_PICK" = "2" ]; then
  if [ "$NETWORK_MODE" = "global-preview" ]; then
    if [ "$AUTO_START_SIGNALING" -eq 1 ]; then
      mkdir -p "$WORK_DIR/.silicaclaw"
      SIGNALING_LOG="$WORK_DIR/.silicaclaw/signaling.log"
      SIGNALING_PID_FILE="$WORK_DIR/.silicaclaw/signaling.pid"
      run_cmd "cd \"$WORK_DIR\" && PORT=${SIGNALING_PORT_VALUE:-4510} nohup npm run webrtc-signaling > \"$SIGNALING_LOG\" 2>&1 & echo \$! > \"$SIGNALING_PID_FILE\""
      success "已后台启动 signaling server"
      kv "日志" "$SIGNALING_LOG"
      kv "停止" "kill \$(cat \"$SIGNALING_PID_FILE\")"
    fi
    echo "将使用以下参数启动（dev watch）："
    kv "Adapter" "$NETWORK_ADAPTER"
    kv "Relay" "$WEBRTC_SIGNALING_URL_VALUE"
    kv "Room" "$WEBRTC_ROOM_VALUE"
    pause_continue
    run_cmd "cd \"$WORK_DIR\" && NETWORK_ADAPTER=$NETWORK_ADAPTER WEBRTC_SIGNALING_URL=$WEBRTC_SIGNALING_URL_VALUE WEBRTC_ROOM=$WEBRTC_ROOM_VALUE npm run local-console"
  else
    echo "将使用以下参数启动（dev watch）："
    kv "Adapter" "$NETWORK_ADAPTER"
    pause_continue
    run_cmd "cd \"$WORK_DIR\" && NETWORK_ADAPTER=$NETWORK_ADAPTER npm run local-console"
  fi
else
  GATEWAY_CMD="cd \"$WORK_DIR\" && npm run gateway -- start --mode=$NETWORK_MODE"
  if [ "$NETWORK_MODE" = "global-preview" ]; then
    GATEWAY_CMD="$GATEWAY_CMD --signaling-url=$WEBRTC_SIGNALING_URL_VALUE --room=$WEBRTC_ROOM_VALUE"
  fi
  echo "将使用 gateway 后台启动："
  kv "Command" "$GATEWAY_CMD"
  pause_continue
  run_cmd "$GATEWAY_CMD"
  echo ""
  success "已启动完成"
  kv "打开" "http://localhost:4310"
  echo ""
  echo "常用命令："
  kv "Status" "silicaclaw status"
  kv "Logs" "silicaclaw logs local-console"
  kv "Stop" "silicaclaw stop"
  echo ""
fi
