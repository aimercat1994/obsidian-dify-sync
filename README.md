# Obsidian Dify Sync

将 Obsidian 笔记同步到 [Dify](https://dify.ai) 知识库。以 Obsidian 为唯一数据源，自动在 Dify 中创建、更新、删除文档，保持两端一致。

## 功能

- **自动同步** — Obsidian 中新建/修改/删除文件时，实时同步到 Dify
- **全量同步** — 一键将所有笔记推送到 Dify，并清理 Dify 端多余文档
- **智能重命名** — 处理文件重命名（删除旧文档 + 创建新文档，Dify 无 rename API）
- **文件夹范围** — 可指定只同步某个子目录，或同步整个 vault
- **手动控制** — 支持手动同步当前文件或全量同步

## 安装

### 通过 BRAT 安装（推荐）

1. 确保已安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. 打开 BRAT 设置 → **Add Beta plugin**
3. 填入仓库地址：`https://github.com/aimercat1994/obsidian-dify-sync`
4. 回到 **第三方插件** 启用 **Dify Sync**

### 从源码构建

```bash
cd /path/to/your-vault/.obsidian/plugins/
git clone https://github.com/aimercat1994/obsidian-dify-sync.git
cd obsidian-dify-sync
npm install
npm run build
```

然后在 Obsidian 中启用：**设置 → 第三方插件 → Dify Sync**。

### 从社区插件市场安装（即将上线）

等审核通过后，可以直接在 Obsidian 的社区插件浏览器中搜索安装。

## 配置

1. 在 Dify 中，进入 **知识库 → Service API**（右上角）
2. 复制 **API 端点**（如 `http://你的-Dify-地址/v1`）
3. 点击 **API Key** → 创建新 Key 并复制
4. 打开要同步的目标知识库，从 URL 中复制 **知识库 ID**

5. 在 Obsidian 中进入 **设置 → Dify Sync**，填写：

| 设置项 | 说明 |
|--------|------|
| Dify API Endpoint | Dify 基础地址，如 `http://192.168.1.10:1180/v1` |
| Knowledge Base API Key | Dify Service API 面板创建的 Key |
| Knowledge Base ID | 知识库 UUID |
| Sync Folder | 要同步的 vault 文件夹（`/` = 整个 vault） |
| Document Language | 文档语言，用于 Dify 分词优化 |
| Auto Sync | 开启后文件变化时自动同步 |

6. 点击 **Sync Now** 执行首次全量同步

## 使用

### 命令

| 命令 | 作用 |
|------|------|
| `Dify Sync：全量同步到 Dify` | 推送所有笔记到 Dify，删除 Dify 中多余的文档 |
| `Dify Sync：同步当前文件到 Dify` | 同步当前打开的笔记 |
| `Dify Sync：测试 Dify 连接` | 测试 Dify API 连通性 |

### 自动同步

开启后，插件监听 vault 事件：

- **新建/修改** → 在 Dify 中创建或更新文档
- **删除** → 从 Dify 中删除对应文档
- **重命名** → 删除旧文档 + 创建新文档

## 工作原理

```
Obsidian Vault（数据源）
         │
         ├─ 新建/修改 → POST /v1/datasets/{id}/document/create-by-text
         │              POST /v1/datasets/{id}/documents/{docId}/update-by-text
         │
         ├─ 删除 ────→ DELETE /v1/datasets/{id}/documents/{docId}
         │
         └─ 重命名 ──→ DELETE 旧 + POST 新
```

插件内部维护一个 `path → dify_document_id` 的映射表，存储在 `data.json` 中，避免重复创建。

### 使用的 Dify API

| 操作 | 方法 | 端点 |
|------|------|------|
| 列出文档 | `GET` | `/datasets/{dataset_id}/documents` |
| 创建文档 | `POST` | `/datasets/{dataset_id}/document/create-by-text` |
| 更新文档 | `POST` | `/datasets/{dataset_id}/documents/{document_id}/update-by-text` |
| 删除文档 | `DELETE` | `/datasets/{dataset_id}/documents/{document_id}` |

## 环境要求

- Obsidian **v1.5.0** 或更高
- Dify（自部署或云版本），已创建知识库
- Node.js 18+（仅源码构建时需要）

## 开发

```bash
# 安装依赖
npm install

# 开发模式（自动监听变化并编译）
npm run dev

# 生产构建
npm run build
```

开发时建议安装 [Hot-Reload](https://github.com/pjeby/hot-reload) 插件，修改代码后自动重载。

## 许可证

MIT
