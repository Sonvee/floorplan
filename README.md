# 户型装修设计

中文 | [English](README.en.md)

纯前端的户型装修设计工具：在 2D 平面图上摆放家具、测量尺寸，一键切换到 Three.js 3D 场景，可以鸟瞰，也可以第一人称漫游。项目采用无构建步骤的静态目录结构，打开 `index.html` 即可使用。

## 功能

**2D 平面布置**
- 按原始户型 1:60 / 1:100 比例显示，尺寸单位 mm
- 从左侧家具库拖入 60 余种家具家电（卧室、客厅、餐厨、卫浴、家电、书房休闲）
- 拖动移动、旋转（Shift 自由角度）、调整尺寸，贴墙自动吸附
- 测量工具（靠近墙面自动吸附，Shift 锁定水平 / 垂直）
- 拆改非承重墙，承重墙单独标示
- 图层开关：尺寸标注、房间名、家具、网格、承重墙

**3D 场景**
- 鸟瞰、斜视、俯视多种视角，点击房间列表可飞到对应房间
- 漫游模式：桌面端 WASD + 鼠标，触屏设备用虚拟摇杆，可以点门开关
- 全高墙 / 剖切墙切换，日照时间滑块，夜景灯光
- 精细家具模型：柜门分缝与拉手、软包床头、带环境反射的金属与陶瓷材质等
- 在 3D 中也能选中、拖动家具，与 2D 方案实时同步

**方案与统计**
- 房间面积与套内使用面积自动统计
- 为每个房间更换地面材料（木地板、地砖、大理石、水磨石、地毯等），按面积加 5% 损耗估算造价
- 撤销 / 重做，方案自动保存在浏览器本地
- 中文 / English 界面切换（顶栏右侧按钮，默认中文，选择会记住）
- 导出 PNG 图片，导出 / 导入方案 JSON

## 快速开始

```bash
git clone <仓库地址>
cd <仓库目录>
```

然后直接用浏览器打开 `index.html`。也可以起一个本地静态服务器：

```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

> Three.js 核心库和 `examples/jsm` addon 已本地化到 `assets/lib/three/`，无需依赖 CDN。

## 目录结构

```text
.
├── index.html                 # 页面入口与语义化布局
├── assets/
│   ├── css/
│   │   └── main.css            # 全局样式与响应式布局
│   ├── js/
│   │   ├── app.js              # 2D 编辑器、状态、家具库与交互
│   │   └── scene3d.js          # Three.js 3D 场景与漫游
│   ├── json/                   # 家具库、材料等静态数据资源
│   ├── images/                 # 预留：纹理、图标、预览图
│   ├── fonts/                  # 预留：本地字体
│   └── lib/                    # 预留：第三方库本地副本说明
├── README.md
└── LICENSE
```

当前仍然保持“无需构建、直接部署”的使用方式。Three.js `0.160.0` 通过 `index.html` 中的 import map 从 `assets/lib/three/` 加载，完整 `examples/jsm` 目录也已随项目分发。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `T` | 切换 2D / 3D |
| `V` / `M` | 选择 / 测量 |
| `R` / `Shift+R` | 选中家具顺时针 / 逆时针旋转 90° |
| `Delete` / `Backspace` | 删除选中家具 |
| `Ctrl/⌘ + D` | 复制选中家具 |
| `Ctrl/⌘ + Z`，`Ctrl/⌘ + Shift + Z` | 撤销，重做 |
| `F` | 适应窗口 |
| `+` / `-` | 放大 / 缩小 |
| `[` / `]` | 展开 / 收起左侧家具库、右侧面板 |
| `Shift + F` | 全屏 |
| `Esc` | 取消当前操作 |
| 漫游：`WASD` / 方向键，`Shift`，`E` | 移动，快走，开关门 |

## 技术栈

- 原生 HTML / CSS / JavaScript，无框架、无构建步骤
- 2D 平面图用 SVG 绘制
- 3D 场景用 [Three.js](https://threejs.org/) r160（OrbitControls、PointerLockControls、RoundedBoxGeometry、RoomEnvironment、CSS2DRenderer）
- 数据保存在 `localStorage`

## 自定义户型

为保持拆分后的职责边界，家具库和地面材料已迁移到 `assets/json/`，后续可继续按资源类型拆分：

- `assets/json/furniture.json`：家具分类、类型、名称、默认尺寸和颜色
- `assets/json/materials.json`：地面材料名称、单价和色板
- `WALLS` / `WINS`：墙体与窗洞，仍由户型初始化逻辑维护
- `buildFurniture()`：各类家具的 3D 模型

改这些数据就能换成自己的户型。

## 社交媒体

- X（Twitter）：[@akokoi1](https://x.com/akokoi1)

## 许可协议

[MIT](LICENSE)
