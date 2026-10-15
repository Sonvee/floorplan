# 户型装修室内设计（离线版）

一个无需安装、无需构建、无需联网的户型装修工具。可以在 2D 平面图中布置家具，并切换到 Three.js 3D 场景查看方案。

本版本位于 `offline` 分支，独立维护，不再合并到 `custom` 分支。

## 使用方法

1. 下载或克隆本分支的完整目录。
2. 保持 `assets/` 目录及其内容完整。
3. 直接双击根目录下的 `index.html`。

不需要安装 Node.js、Python 或其他依赖，也不需要启动本地服务器。页面中的 JavaScript、Three.js 和内置数据都从项目目录加载。

> 浏览器对 `file://` 下的本地存储行为可能存在差异。重要方案请使用“导出方案 JSON”保存备份。

## 主要功能

- 2D 户型编辑：查看墙体、门窗、房间和尺寸，拖入家具并调整位置、角度和尺寸。
- 3D 场景：鸟瞰或漫游查看户型，调整墙体显示、灯光和材料。
- 方案管理：撤销和重做，导入或导出 JSON，导出 PNG 图片。
- 本地保存：方案保存在浏览器本地，不上传到服务器。

## 目录说明

```text
.
├── index.html                 # 页面入口
├── assets/
│   ├── css/                   # 页面样式
│   ├── js/                    # 2D 编辑器、户型编辑器和 3D 场景脚本
│   ├── data/                  # 家具、材料、墙体和门窗数据
│   ├── example/               # 内置示例户型
│   ├── prompt/                # 户型转 JSON 的提示词
│   └── lib/three/classic/     # 可离线加载的 Three.js 经典脚本
├── README.md
└── LICENSE
```

## 修改内置数据

常用数据文件如下：

- `assets/data/furniture.js`：家具分类、名称、默认尺寸和颜色。
- `assets/data/materials.js`：地面材料名称、价格和颜色。
- `assets/data/plan-elements.js`：墙体、门和窗的配置。
- `assets/example/plan-demo.js`：打开页面时使用的示例方案。

修改这些文件后，重新打开 `index.html` 即可看到变化。

## 许可

[MIT](LICENSE)
