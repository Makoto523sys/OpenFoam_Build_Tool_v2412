const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
html = html.replace('<!-- BUILD:workbench -->', () => fs.readFileSync(path.join(root, 'src/workbench.html'), 'utf8'));
for (const name of ['geometry', 'viewer', 'acceleration', 'waveform', 'water-region', 'workbench', 'waveform-ui', 'inputs-ui']) {
  const code = fs.readFileSync(path.join(root, `src/${name}.js`), 'utf8');
  html = html.replace(`/* BUILD:${name} */`, () => code);
}
fs.writeFileSync(path.join(root, 'OpenFOAM_v2412_case_builder_v8_3.html'), html);
