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
