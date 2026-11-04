const path = require('path'); const fs = require('fs');
global.env = { getUserVariables: () => ({}) };
const localCopy = path.join(__dirname, '_plugin_under_test.js');
fs.copyFileSync(path.resolve(__dirname, '../plugins/full-track.js'), localCopy);
const plugin = require(localCopy);
const cases = [
  ['【纯享版】海阔天空', 'Beyond', 320],
  ['海阔天空 (Live版)', 'Beyond', 369],
  ['Shape of You', 'Ed Sheeran', 233],
  ['Lemon', '米津玄师', 255],
  ['起风了', '', 329],
  ['爱', '', 240],
  ['Canon in D', 'Pachelbel', 295],
  ['夜空中最亮的星', '逃跑计划', 254],
  ['小幸运', '田馥甄', 268],
  ['我不愿让你一个人', '五月天', 320],
  ['abcdefghijk123', '不存在的歌手xyz', 200],
  ['权力的游戏', 'Ramin Djawadi', 260],
];
(async () => {
  for (const [t,a,d] of cases) {
    const t0 = Date.now();
    try {
      const r = await plugin.getMusicAlternatives({ id:'0', title:t, artist:a, duration:d }, 1);
      const data = r?.data || [];
      const origin = data.filter(x=>x.isOriginArtist).length;
      console.log(`${data.length?'✓':'○'} "${t}" - ${a||'(无歌手)'} :: 候选=${data.length} 原唱=${origin} ${((Date.now()-t0)/1000).toFixed(1)}s`);
      data.slice(0,2).forEach(x=>console.log(`      · ${x.title} / ${x.artist} / ${Math.floor(x.duration/60)}:${String(x.duration%60).padStart(2,'0')}`));
    } catch(e) {
      console.log(`✗ "${t}" 抛错: ${e.message}`);
    }
  }
})();
