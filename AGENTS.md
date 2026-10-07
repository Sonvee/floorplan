# AGENTS.md

## Git 分支与同步规则

- 本仓库是从 GitHub fork 的仓库。
- `main` 分支用于通过 GitHub 的 **Fork sync** 同步官方仓库源码，不在该分支进行自定义定制修改。
- `custom` 分支用于维护本仓库的自定义定制修改。
- 后续合并官方代码时，必须先将 `main` 分支通过 **Fork sync** 同步到官方仓库的最新源码，再将更新后的 `main` 合并到 `custom` 分支。
