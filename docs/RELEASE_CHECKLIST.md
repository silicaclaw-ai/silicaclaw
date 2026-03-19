# Release Checklist

发布完成后，按下面这套固定流程做 1 分钟验证。

## 1. 检查 npm tag

```bash
npm dist-tag ls @silicaclaw/cli
```

必须确认：

- `latest` 指向这次正式要给用户用的版本

## 2. 检查实际拿到的版本

```bash
npx -y @silicaclaw/cli@latest --version
```

目标是：

- `latest` 输出刚发布的版本

## 3. 检查持久命令安装后跑的是谁

```bash
npx -y @silicaclaw/cli@latest install
source ~/.silicaclaw/env.sh
type silicaclaw
which silicaclaw
sed -n '1,20p' ~/.silicaclaw/bin/silicaclaw
silicaclaw --version
```

重点看：

- `~/.silicaclaw/bin/silicaclaw` 是否还在跑错误 tag
- `silicaclaw --version` 是否直接输出新 CLI，而不是老帮助页

## 4. 检查核心命令链

```bash
silicaclaw update
silicaclaw start
silicaclaw status
silicaclaw stop
```

目标是：

- 这四个都能进入新 CLI
- 不会再掉回旧版 help 文本

## 5. 检查页面版本和基础服务

```bash
silicaclaw start
curl -s http://localhost:4310/api/overview
curl -s http://localhost:4310/api/runtime/paths
```

重点看：

- `app_version`
- `storage_root`
- `data_dir`

## 6. 检查资料是否保留

```bash
ls -la ~/.silicaclaw/local-console/data
cat ~/.silicaclaw/local-console/data/profile.json
cat ~/.silicaclaw/local-console/data/identity.json
```

确认：

- 文件存在
- 更新或重启后内容没有变空

## 7. 检查旧缓存迁移是否还有机会

```bash
find ~/.silicaclaw ~/.npm -name profile.json 2>/dev/null | grep silicaclaw
find ~/.silicaclaw ~/.npm -name identity.json 2>/dev/null | grep silicaclaw
```

如果用户反馈“资料丢了”，这一步最直接。

## 最关键的三件事

- `dist-tag` 没挂反
- `silicaclaw --version` 命中的是新 CLI
- `profile.json` 和 `identity.json` 还在固定目录里
