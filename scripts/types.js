const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';
async function get(path, params){const u=new URL('https://music.163.com'+path);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{'user-agent':UA,referer:'https://music.163.com/',cookie:'os=pc; appver=2.9.7'},signal:AbortSignal.timeout(15000)});return r.json();}
(async()=>{
  const types={1:'单曲',10:'专辑',100:'歌手',1000:'歌单'};
  for(const [t,label] of Object.entries(types)){
    const m=await get('/api/search/get',{s:'周杰伦',type:t,offset:0,limit:10});
    const c=await get('/api/cloudsearch/pc',{s:'周杰伦',type:t,offset:0,limit:10});
    const key={1:'songs',10:'albums',100:'artists',1000:'playlists'}[t];
    console.log(`type=${t}(${label}) search/get: code=${m.code} n=${m?.result?.[key]?.length} | cloudsearch: code=${c.code} n=${c?.result?.[key]?.length}`);
    if(m?.result?.[key]?.[0]) console.log(`    sample: ${JSON.stringify(m.result[key][0]).slice(0,150)}`);
  }
})();
