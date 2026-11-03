# 开发说明

## 项目结构

```text
markmind/
├── manifest.json                  Chrome 扩展清单
├── popup.html / popup.css / popup.js
├── background.js                 后台任务入口
├── ai-client.js                  服务商请求与 JSON 响应解析
├── engine.js                     分类规则和目标路径规划
├── rename-*.js                   AI 命名与预览
├── organize-*.js                 指令整理与范围选择
├── library-tools.js              书签检索与就地操作
├── impression-engine.js          本地功能搜索
├── semantic-search-background.js AI 扩展搜索
├── dead-links*.js                 网址状态检测
├── backup.js                     备份与恢复
├── icons/
├── tests/
└── scripts/
```

## 运行

将项目根目录作为已解压扩展加载到 Chrome/Edge。无需 Webpack、Vite 或 NPM 依赖。代码通过 `importScripts` 和按顺序加载的传统脚本组织模块；调整入口时请同步检查 `manifest.json` 与 `popup.html`。

## 安全约束

- 所有实际书签写入动作必须由用户确认；AI 生成的 ID、目标文件夹等都需要严格与用户已选范围比对。
- 不应在日志、错误报告和提交内容中包含 API Key 或完整用户书签数据。
- 新增网络目标时，检查 `manifest.json` 的权限范围和 `docs/PRIVACY.md` 的披露。
- 优先使用 `textContent` 和 DOM 创建 API 展示不可信的书签标题或模型响应，避免拼接 HTML。
- 修改备份或移动逻辑时，验证撤销、已存在目标目录及任务中断路径。

## 测试与发布

运行 `npm run check`；CI 使用同一命令检查 Manifest V3、图标、脚本引用、语法和测试用例。`npm run package` 生成一个可在浏览器开发者模式直接安装的源码 ZIP。发布时应手工检查插件 UI、至少一种真实 AI API 连接及死链网站访问授权。
