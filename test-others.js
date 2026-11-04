const path = require('path'); const fs = require('fs');
global.env = { getUserVariables: () => ({}) };
const base = 'C:/Users/Lenovo/AppData/Roaming/MusicFree/musicfree-plugins/';
async function load(name){const c=path.join(__dirname,'_'+name);fs.copyFileSync(base+name,c);return require(c);}
(async()=>{
  for (const name of ['music-chart.js','hot-sheets.js']) {
    const p = await load(name);
    for (const [t,label] of [['music','单曲'],['album','专辑'],['artist','歌手'],['sheet','歌单']]) {
      try {
        const r = await p.search('周杰伦', 1, t);
        console.log(`✓ ${name} search(${label}) => ${r.data.length} 条 isEnd=${r.isEnd} 首条=${r.data[0]?.title||r.data[0]?.name||'-'}`);
      } catch(e){ console.log(`✗ ${name} search(${label}) 抛错 ${e.message}`); }
    }
  }
})();
