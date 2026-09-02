import { readFileSync } from 'fs';
const ip = readFileSync('TRT-Nova-植宠IP升级版.html','utf8');
const hd = readFileSync('TRT-Nova-植宠合订版.html','utf8');

// IP 浅色模板标题
const tplsS = ip.indexOf('<div id="tpls"');
const tplsE = ip.indexOf('</div><!-- /tpls -->');
const lightTpls = ip.slice(tplsS, tplsE);
console.log('--- IP 浅色模板 ---');
for (const m of lightTpls.matchAll(/<div data-tpl="(p\d+)">[\s\S]*?<h2>([^<]*)<\/h2>/g)) console.log(m[1], '→', m[2]);

const ds = ip.indexOf('<div id="tpls-dark" hidden>');
const de = ip.indexOf('</div><!-- /tpls-dark -->');
const darkTpls = ip.slice(ds, de);
console.log('--- IP 深色模板 ---');
for (const m of darkTpls.matchAll(/<div data-tpl="(p\d+)">[\s\S]*?<h2>([^<]*)<\/h2>/g)) console.log(m[1], '→', m[2]);

// 养护技巧 / 设备字段 出现位置
for (const [f, name] of [[ip,'IP'],[hd,'HD']]) {
  for (const kw of ['养护技巧','设备字段']) {
    let i = -1;
    while ((i = f.indexOf(kw, i+1)) !== -1) {
      const line = f.slice(0,i).split('\n').length;
      console.log(`${name} "${kw}" @line ${line}: ` + f.slice(i-60, i+80).replace(/\n/g,' '));
    }
  }
}
