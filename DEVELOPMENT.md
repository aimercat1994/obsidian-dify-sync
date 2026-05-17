# Obsidian Dify Sync 开发记录

## 项目信息

- **仓库**：https://github.com/aimercat1994/obsidian-dify-sync
- **本地源码**：/tmp/obsidian-dify-sync/
- **Obsidian vault 插件路径**：`{vault}/.obsidian/plugins/dify-sync/`

## 技术栈

| 项目 | 说明 |
|------|------|
| 语言 | TypeScript (ES2020 target) |
| 构建 | esbuild (bundle → CJS) |
| 依赖 | obsidian (1.5.0 types) |
| 运行时 | Obsidian 插件沙箱环境 |
| 外部 API | Dify Knowledge Base REST API |

## 项目结构

```
obsidian-dify-sync/
├── src/
│   ├── main.ts           # 插件入口（生命周期、命令、事件绑定）
│   ├── settings.ts       # 设置接口 + 默认值
│   ├── settings-ui.ts    # 设置面板 UI（全中文）
│   ├── dify-client.ts    # Dify API 客户端
│   └── sync-engine.ts    # 同步引擎（增量+全量）
├── manifest.json
├── versions.json         # BRAT 版本追踪
├── package.json
├── tsconfig.json
├── esbuild.config.mjs    # 构建配置
├── styles.css
├── main.js               # 编译产物
└── README.md
```

## 构建命令

```bash
cd /tmp/obsidian-dify-sync

# 类型检查
npx tsc --noEmit --skipLibCheck

# 生产构建
node esbuild.config.mjs production

# 开发模式（自动 watch）
npm run dev
```

⚠️ 注意事项：
- npx 可能找到错误的包（如 `tsc` 是 npm 上的另一个包），推荐用 `./node_modules/.bin/tsc`
- esbuild.config.mjs 必须用 ESM import（`require` 在 Node v23 .mjs 中不可用）
- RTK 会拦截 git 命令，中文 commit message 可能导致 panic，用 `/usr/bin/git` 绕过

## 核心架构

### 数据流

```
Obsidian Vault 事件           Dify API
─────────────────────         ─────────
create → onFileCreated   →   POST /datasets/{id}/document/create-by-text
modify → onFileModified  →   POST /datasets/{id}/documents/{docId}/update-by-text
delete → onFileDeleted   →   DELETE /datasets/{id}/documents/{docId}
rename → onFileRenamed   →   DELETE 旧 + POST 新（Dify 无 rename API）
```

### 映射存储

`data.json` 结构：
```json
{
  "settings": { ... },
  "mapping": {
    "path/to/note.md": "dify-document-uuid"
  }
}
```

### settings.ts 接口

```ts
interface DifySyncSettings {
  endpoint: string;       // Dify API 端点，如 http://192.168.1.10:1180/v1
  apiKey: string;         // 知识库 API Key
  datasetId: string;      // 知识库 UUID
  syncFolder: string;     // 同步范围，"/" = 全 vault
  autoSync: boolean;      // 是否自动同步
  docLanguage: string;    // Chinese / English / Japanese
}
```

### Dify API 端点

| 操作 | 方法 | URL |
|------|------|-----|
| 列出文档 | GET | `/v1/datasets/{id}/documents?page=N&limit=100` |
| 创建文档 | POST | `/v1/datasets/{id}/document/create-by-text` |
| 更新文档 | POST | `/v1/datasets/{id}/documents/{docId}/update-by-text` |
| 删除文档 | DELETE | `/v1/datasets/{id}/documents/{docId}` |

认证方式：`Authorization: Bearer {apiKey}`

## 开发踩坑记录

### 1. Obsidian Vault 事件类型不匹配
`vault.on()` 回调签名是 `(...data: unknown[]) => unknown`，不能用 `(file: TAbstractFile) => void` 直接传参。解决方法：用 `...args: unknown[]` 接收并手动 `as` 转型。

### 2. loadData() 返回 unknown
`Plugin.loadData()` 返回 `Promise<unknown>`，需要 `as Record<string, unknown>` 转型再取属性。

### 3. Map for...of 在 ES2020 下报错
`for (const [k, v] of map)` 需要 `downlevelIteration` 或 `ES2015+` target。改为 `.forEach()` 遍历。

### 4. GitHub MCP 只读
Copilot MCP Token 无 `repo` scope，不能创建仓库。需要用户提供 classic PAT（勾选 `repo` + `workflow`）。用 curl 带 `X-GitHub-Api-Version: 2022-11-28` header 可绕过。

### 5. BRAT 要求 versions.json
BRAT 安装需要仓库根目录有 `versions.json`，格式 `{"version": "minAppVersion"}`。

## 发布流程

1. 更新 `manifest.json` 的 `version`
2. 更新 `versions.json`
3. 编译：`node esbuild.config.mjs production`
4. 提交 + 打 tag + 推送：
   ```bash
   /usr/bin/git add -A
   /usr/bin/git commit -m "release: vX.Y.Z"
   /usr/bin/git tag -a X.Y.Z -m "X.Y.Z"
   /usr/bin/git push --tags
   /usr/bin/git push
   ```
5. GitHub Actions 自动创建 release（需 `.github/workflows/release.yml`）

## 后续开发方向

- [ ] 支持按标签/文件夹过滤同步
- [ ] 同步进度指示器
- [ ] 冲突处理策略（Dify 端也有修改时）
- [ ] 支持附件/图片同步
- [ ] 增量同步优化（基于文件 hash 判断是否真的有变化）
- [ ] 提交到 Obsidian Community Plugins
