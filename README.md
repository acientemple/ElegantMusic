# ElegantMusic（清雅音乐）

MusicFree 桌面版（0.0.8 便携版）插件的开发仓库。仓库是**插件的唯一真源**：
所有改动先落在 `plugins/`，测试通过后再分发到各台 MusicFree 实例。

## 目录结构

```
plugins/          插件真身（自研 7 个 + third-party/ 1 个）
scripts/          调试与测试脚本（126 个），全部指向 ../plugins，不再引用已部署副本
tools/            sync-plugins.js 分发脚本
docs/             文档
```

`plugins/third-party/` 存放第三方插件，分发时会被拍平到插件目录根部——
应用的插件扫描是扁平的（`readdir` + `.js` 后缀，不递归子目录）。

## 工作流

```bash
# 1. 改 plugins/ 下的插件

# 2. 跑测试（脚本已指向仓库内的 plugins/）
node scripts/test-netease-fallback.js
node scripts/test-lyric-source.js

# 3. 看分发差异
node tools/sync-plugins.js --check

# 4. 分发到各个实例
node tools/sync-plugins.js

# 5. 重启 MusicFree（便携版无插件热重载，必须重启）
```

应用内调试用 CDP：

```bash
node scripts/cdp.js scripts/_ui_full.js      # 在渲染进程里执行一段 JS
```

## 各实例的位置

| 实例 | 插件目录 |
|---|---|
| 便携版 | `D:\work\OneDrive\Desktop\MusicFree-0.0.8-win32-x64-portable\MusicFree-0.0.8-win32-x64-portable\portable\userData\musicfree-plugins` |
| 开发版（源码 `D:\work\MusicFreeDesktop`） | `C:\Users\Lenovo\AppData\Roaming\MusicFree\musicfree-plugins` |

两套 userData 互不相通，改一处不会影响另一处，所以分发要两个都发。

## 个人数据在哪（不入库）

个人数据全在各自的 `userData` 里，落在两个后端：

| 数据 | 位置 |
|---|---|
| 播放队列 `playList`、搜索历史 `searchHistory`、已下载 `downloadedList`、收藏歌单 `starredMusicSheets` | `IndexedDB/file__0.indexeddb.leveldb/` |
| 界面偏好与设置 | `Local Storage/leveldb/` |
| 应用配置（含 `private.*` 窗口位置、`download.path`） | `config.json` |
| 插件私有 KV（插件一旦调用 `musicfree/storage` 就会产生，可能含 token） | `appData/musicfree-plugin-storage/chunk.json` |

`.gitignore` 已排除 `userData/`、`appData/`、`musicfree-plugin-storage/`。
`appData` 下的插件存储默认创建在 `%APPDATA%\` 根部而非 `MusicFree` 文件夹里，
很容易漏掉，注意别把它拷进仓库。

## 我的歌单导出（改源码加的功能）

便携版 0.0.8 原版只能在「设置 → 备份」里把歌单导成一份备份 JSON，
没有「导出某个歌单」这种面向用户的入口。这个功能是直接改
`D:\work\MusicFreeDesktop` 源码加的，插件沙箱读不到应用的 IndexedDB，做不了。

两个入口：

- 侧边栏「我的歌单」标题栏的 **导出全部歌单** 按钮 → 导出所有本地歌单
- 侧边栏某个歌单**右键 → 导出歌单** → 导出单个（「我喜欢」也能导出）

导出的是 JSON，文件名形如 `MusicFree-我喜欢-2026-11-04.json`：

- 歌单名里的 Windows 非法字符（`\ / : * ? " < > |`）会被替换成 `_`
- 文件内容是 `{ "musicSheets": [...] }`，与「设置 → 备份」产出的格式同构

### 导出的文件怎么导回来

「设置 → 备份 → 恢复歌单」选这个文件即可，两种模式的区别：

| 模式 | 已有歌单 | 默认歌单「我喜欢」 |
|---|---|---|
| 追加到已有歌单末尾 | 保留原歌单，另建一份同名副本 | **并入原「我喜欢」**，不建副本 |
| 覆盖已有歌单 | 先删掉全部本地歌单再导入 | 先清空再导入，不建副本 |

默认歌单在任何模式下都不会产生同名副本，这是本次改动顺带修掉的行为
（原先追加模式下会多出一个「我喜欢」）。

### 导出前会做的清洗

`musicList` 里被删除过的歌曲在数据库中查不到，导出时会是 `null`；
回导时 `addMusicToSheet` 遇到 `null` 会抛错并被静默吞掉，
结果是**整张歌单的歌曲无声丢失**。导出侧已过滤这些空项，
回导侧也做了一道过滤，所以脏文件不会把歌单清空。

另外歌曲引用计数用的 `$ref` 字段会破坏回导时的计数，导出时已剥离。

### 重新部署到便携版

改动只存在于源码树里，要生效必须重新打包并替换便携版两处：

```bash
cd D:/work/MusicFreeDesktop && npm run package
```

- `resources/app/.webpack/` —— main + renderer bundle
- `resources/res/lang/*.json` —— i18n 文案是主进程运行时读盘的，不在 bundle 里

流程：关掉便携版 `MusicFree.exe`（否则文件被占用）→ 复制产物 → 重新启动。
