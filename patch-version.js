const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/Lenovo/AppData/Roaming/MusicFree/musicfree-plugins';
const bumps = {
    'lyric-source.js': ['1.0.0', '1.1.0'],
    'music-chart.js': ['1.1.0', '1.2.0'],
    'hot-sheets.js': ['1.1.0', '1.2.0'],
    'full-track.js': ['1.3.0', '1.4.0'],
};

Object.entries(bumps).forEach(([name, [from, to]]) => {
    const file = path.join(dir, name);
    let text = fs.readFileSync(file, 'utf8');
    const needle = `version: '${from}'`;
    if (!text.includes(needle)) {
        throw new Error(`version ${from} not found in ${name}`);
    }
    text = text.replace(needle, `version: '${to}'`);
    fs.writeFileSync(file, text);
    console.log(`${name}: ${from} -> ${to}`);
});
