# 内置数据

通过普通 script 标签加载数据，支持直接双击 index.html，无需 Fetch、XHR 或服务器。

- furniture.js：家具分类、类型、名称、宽深尺寸和默认颜色。
- materials.js：地面材料名称、单价和色板。
- plan-elements.js：墙体、窗户和门类型、图标与提示文案。
- ../example/plan-demo.js：文件菜单中可导入的样例方案。

直接编辑这些文件中 window.PlanData 对应属性的对象或数组即可更新配置。导入和导出用户方案仍采用 JSON 文件。
