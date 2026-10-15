# 第三方库

Three.js 版本为 0.160.0（r160），许可证见 [three/LICENSE](three/LICENSE)。

index.html 使用 three/classic/ 下的经典脚本，支持 file:// 页面：先加载 three.min.js，再加载 controls、geometries、environments、renderers 中项目使用的 addon。核心库暴露 window.THREE，各 addon 在自己的函数作用域中运行，并将导出附加到 THREE。

three/build/three.module.min.js 与 three/examples/jsm/ 保留原始 ESM 版本供对照。classic 版本仅调整模块包装：核心库的导出变为 window.THREE；addon 从 THREE 读取依赖并把公开类附加到 THREE。升级 Three.js 时应同步更新两个版本，保留许可证，并由开发者手动验证 3D 功能。
