#!/usr/bin/env node
/**
 * 把仓库里的 plugins/ 分发到各个 MusicFree 实例的插件目录。
 *
 *   node tools/sync-plugins.js            # 分发
 *   node tools/sync-plugins.js --check    # 只比对差异，不写入
 *   node tools/sync-plugins.js --target 便携版
 *
 * 插件目录是扁平扫描的（readdir + .js），所以 third-party/ 会被拍平到目标目录根部。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'plugins');

const TARGETS = [
    {
        name: '便携版',
        dir: 'D:/work/OneDrive/Desktop/MusicFree-0.0.8-win32-x64-portable/MusicFree-0.0.8-win32-x64-portable/portable/userData/musicfree-plugins',
    },
    {
        name: '开发版',
        dir: 'C:/Users/Lenovo/AppData/Roaming/MusicFree/musicfree-plugins',
    },
];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const onlyTarget = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;

function sha1(file) {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/** 收集要分发的插件：plugins/*.js 与 plugins/third-party/*.js 拍平后合并 */
function collectPlugins() {
    const files = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
        }
    };
    walk(SOURCE_DIR);
    return files.map((file) => ({
        name: path.basename(file),
        file,
        sha1: sha1(file),
    }));
}

const plugins = collectPlugins();
if (!plugins.length) {
    console.error('❌ plugins/ 里没有找到任何 .js 插件');
    process.exit(1);
}

console.log(`仓库插件 ${plugins.length} 个：${plugins.map((p) => p.name).join(', ')}\n`);

let changed = 0;
let unchanged = 0;
let missing = 0;

for (const target of TARGETS) {
    if (onlyTarget && target.name !== onlyTarget) continue;

    console.log(`── ${target.name} ──`);
    console.log(`   ${target.dir}`);

    if (!fs.existsSync(target.dir)) {
        console.log('   ⚠️  目录不存在，跳过\n');
        continue;
    }

    for (const plugin of plugins) {
        const dest = path.join(target.dir, plugin.name);
        const exists = fs.existsSync(dest);

        if (!exists) {
            missing++;
            console.log(`   + 新增  ${plugin.name}`);
            if (!checkOnly) fs.copyFileSync(plugin.file, dest);
            continue;
        }

        if (sha1(dest) === plugin.sha1) {
            unchanged++;
            continue;
        }

        changed++;
        console.log(`   ~ 更新  ${plugin.name}`);
        if (!checkOnly) fs.copyFileSync(plugin.file, dest);
    }

    if (checkOnly) console.log('   （--check 模式，未写入）');
    console.log('');
}

console.log(`共 ${plugins.length} 个插件 × ${TARGETS.filter((t) => !onlyTarget || t.name === onlyTarget).length} 个实例`);
console.log(`更新 ${changed}，新增 ${missing}，已是最新 ${unchanged}`);

if (checkOnly && (changed || missing)) {
    console.log('\n存在差异，跑一次 node tools/sync-plugins.js 即可同步。');
}
