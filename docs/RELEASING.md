# 版本发布

项目默认分支 `main` 的推送会运行两套 GitHub Actions 工作流：

- `Validate extension`：检查 Manifest、源码、自动测试和安装包生成。
- `Publish extension`：重复校验并创建 `dist/markmind-<版本号>.zip`，上传到 GitHub Releases 的 `v<版本号>` 版本。

版本号来自 `manifest.json`，并应与 `package.json` 一致。同版本再次推送会替换已有 Release 的 ZIP 附件，不改动旧标签指向；要发布新版本，请同步递增两个文件中的版本号。

Release 的 ZIP 在根目录直接包含 `manifest.json`、扩展脚本、HTML、CSS 和图标，适用于 Chrome / Edge 开发者模式安装。

仓库主页 About 的简短介绍、主题标签以及仓库名称属于 GitHub 仓库设置，不是 README 文件内容；若需更改，请在仓库 Settings 中编辑。
