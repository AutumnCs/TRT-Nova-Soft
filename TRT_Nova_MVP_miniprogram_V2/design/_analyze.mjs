import { readFileSync } from 'fs';
const ip = readFileSync('TRT-Nova-植宠IP升级版.html','utf8');
const hd = readFileSync('TRT-Nova-植宠合订版.html','utf8');

// IP tpls-dark 区域
const ds = ip.indexOf('<div id="tpls-dark" hidden>');
const de = ip.indexOf('</div><!-- /tpls-dark -->');
const darkHtml = ip.slice(ds, de);

// 类名集合
const classes = new Set();
for (const m of darkHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => classes.add(c));

// 合订版已定义类
const css = hd.match(/<style>([\s\S]*?)<\/style>/)[1];
const defined = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);

const missing = [...classes].filter(c => !defined.has(c));
console.log('total:', classes.size, 'missing:', missing.length);
console.log(missing.join('\n'));

// IP 变量定义
const ipVars = ip.match(/body\.theme-dark\{[^}]+\}/);
console.log('\n--- IP dark vars ---\n' + (ipVars ? ipVars[0] : 'NOT FOUND'));
const ipRoot = ip.match(/:root\{[^}]+\}/);
console.log('\n--- IP root vars ---\n' + (ipRoot ? ipRoot[0].slice(0,800) : 'NOT FOUND'));
