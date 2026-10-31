// A decade: generate the page's world and run it for years (40 seasons by default), logging each season the animals (rabbits,
// grasshoppers and their eggs, foxes, birds and their eggs), grass cells, live trees of each kind, trees born and how the dead ones
// died (fire, thirst, old age, other: felled or uprooted), and lightning strikes; and under each season the range of rabbits,
// the most grasshoppers and the biggest fire seen in it. Nothing should die out for good.
// usage: node tools/decade.js [seed] [seasons] [save prefix]   (SIMFILE=other.html runs another copy; NOLIGHT=1 turns lightning
// off; LOAD=file starts from a save; with a save prefix, writes <prefix>-y<n>.sav at the end of each year)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed=+(process.argv[2]||12345), seasons=+(process.argv[3]||40), out=process.argv[4];
const { E, PLANT, RABBIT, HOPPER, FOX, BIRD, FIRE, EMBER, CHAR, ASH } = Sim.ids;
const g=new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); const fs=require('fs');
if (process.env.LOAD){ Sim.reseed(seed); g.load(fs.readFileSync(process.env.LOAD,'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE-g.W)/2/Sim.REGION)*Sim.REGION);
if (process.env.NOLIGHT) g.lightning=false;
const cause={fire:0,thirst:0,old:0,other:0,sprouted:0}; let lastDK=g.droughtKills;
const rel=g.releaseTree.bind(g);
g.releaseTree=function(t){ let burnt=0; for (const [i] of t.cells){ const c=g.type[i]; if (c===FIRE||c===EMBER||c===CHAR||c===ASH) burnt++; }
  if (g.droughtKills>lastDK){ cause.thirst++; lastDK=g.droughtKills; } else if (burnt>=2) cause.fire++; else if (t.age>t.span) cause.old++; else cause.other++;
  return rel(t); };
let born=0; const ids=new Set(g.trees.map(t=>t.id));
function soil(){ let m=0,n=0; const T=g.type; for (let x=0;x<g.W;x++){ let y=0; for (;y<g.H;y++){ const i=g.idx(x,y), t=T[i]; if (g.owner[i]) continue; if (t!==E && Sim.EL[t].kind!=='gas') break; } for (let k=0;k<10 && y+k<g.H;k++){ const i=g.idx(x,y+k); if (T[i]===Sim.ids.DIRT){ m+=g.life[i]&255; n++; } } } return n ? m/n : 0; }   // mean moisture of the dirt in the top 10 rows of ground
function count(){ const r={rab:0,hop:0,eggs:0,fox:0,bird:0,nest:0,grass:0,fire:0}; const T=g.type;
  for (let i=0;i<T.length;i++){ const t=T[i]; if (t===RABBIT) r.rab++; else if (t===HOPPER){ if (g.life[i]&Sim.EGG) r.eggs++; else r.hop++; } else if (t===FOX) r.fox++; else if (t===BIRD){ if (g.life[i]&Sim.EGG) r.nest++; else r.bird++; } else if (t===PLANT&&!g.owner[i]) r.grass++; else if (t===FIRE||t===EMBER) r.fire++; }
  return r; }
const t0=Date.now();
for (let s=0;s<=seasons;s++){
  const r=count(); const live=g.trees.filter(t=>!t.dead&&!t.cones&&!t.sprout); const con=live.filter(t=>t.con).length;
  console.log(`y${(s/4).toFixed(2)} ${g.seasonName} wet ${(g.wet||0).toFixed(2)}: rab ${r.rab} hop ${r.hop}/${r.eggs}e fox ${r.fox} bird ${r.bird}/${r.nest}n grass ${r.grass} soil ${soil().toFixed(0)} | trees ${live.length-con}b ${con}c born ${born} died fire ${cause.fire} thirst ${cause.thirst} old ${cause.old} other ${cause.other} strikes ${g.strikes} [${((Date.now()-t0)/60000).toFixed(1)}m]`);
  if (out && s%4===0 && s) fs.writeFileSync(`${out}-y${s/4}.sav`, g.save());
  if (s<seasons){ let mx={rab:0,hop:0,fire:0}, mn={rab:1e9};
    for (let f=0;f<Sim.YEAR/4;f++){ g.step(); if (f%900===0){ for (const t of g.trees) if (!ids.has(t.id)){ ids.add(t.id); born++; } if (f%1800===0){ const c=count(); mx.rab=Math.max(mx.rab,c.rab); mn.rab=Math.min(mn.rab,c.rab); mx.hop=Math.max(mx.hop,c.hop); mx.fire=Math.max(mx.fire,c.fire);} } }
    console.log(`   season range: rab ${mn.rab}-${mx.rab} hop max ${mx.hop} fire max ${mx.fire}`); }
}
