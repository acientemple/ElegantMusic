const path = require('path'); const fs = require('fs');
global.env = { getUserVariables: () => ({}) };
fs.copyFileSync(path.resolve(__dirname, '../plugins/full-track.js'), path.join(__dirname,'_plugin_under_test.js'));
const plugin = require(path.join(__dirname,'_plugin_under_test.js'));
(async () => {
  const seen = new Set();
  for (let p = 1; p <= 4; p++) {
    const r = await plugin.search('信仰', p, 'music');
    const ids = r.data.map(x=>x.id);
    const dup = ids.filter(i=>seen.has(i)).length;
    ids.forEach(i=>seen.add(i));
    console.log(`page${p}: ${r.data.length} 条 isEnd=${r.isEnd} 重复=${dup} 首条=${r.data[0]?.title}`);
  }
})();
