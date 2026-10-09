# lib

第三方库目录。

当前项目已将 Three.js `0.160.0` 的核心文件和项目实际使用的 `examples/jsm` addon 本地化：

```text
assets/lib/three/
├── build/three.module.min.js
├── examples/jsm/
└── LICENSE
```

`index.html` 通过 import map 使用本地资源：

```json
{
  "three": "./assets/lib/three/build/three.module.min.js",
  "three/addons/": "./assets/lib/three/examples/jsm/"
}
```
