import fs from 'node:fs/promises';
const directory = 'public/fonts';
await fs.mkdir(directory, { recursive: true });
const stylesheet =
  'https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,400..600;1,400..600&family=Manrope:wght@400..700&display=swap';
const response = await fetch(stylesheet, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
});
if (!response.ok) throw new Error('Font CSS ' + response.status);
let css = await response.text();
const urls = [
  ...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1])),
];
for (let i = 0; i < urls.length; i++) {
  const res = await fetch(urls[i]);
  if (!res.ok) throw new Error('Font ' + res.status);
  const filename = 'font-' + String(i + 1).padStart(2, '0') + '.woff2';
  await fs.writeFile(
    directory + '/' + filename,
    Buffer.from(await res.arrayBuffer())
  );
  css = css.split(urls[i]).join('/fonts/' + filename);
}
await fs.writeFile(directory + '/fonts.css', css);
await fs.writeFile(
  directory + '/SOURCES.md',
  'Stylesheet: ' +
    stylesheet +
    '\nOriginal font files: Google Fonts font CDN\nLicense: SIL OFL 1.1\n'
);
for (const family of ['literata', 'manrope']) {
  const r = await fetch(
    'https://raw.githubusercontent.com/google/fonts/main/ofl/' +
      family +
      '/OFL.txt'
  );
  if (!r.ok) throw new Error('License ' + r.status);
  await fs.writeFile(directory + '/' + family + '-OFL.txt', await r.text());
}
console.log(
  'Downloaded ' + urls.length + ' local font subsets and two licenses.'
);
