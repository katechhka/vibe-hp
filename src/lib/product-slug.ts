export function productSlug(name: string, products: { slug: string }[] = []) {
  const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const letters = [
    'a',
    'b',
    'v',
    'g',
    'd',
    'e',
    'yo',
    'zh',
    'z',
    'i',
    'y',
    'k',
    'l',
    'm',
    'n',
    'o',
    'p',
    'r',
    's',
    't',
    'u',
    'f',
    'kh',
    'ts',
    'ch',
    'sh',
    'shch',
    '',
    'y',
    '',
    'e',
    'yu',
    'ya',
  ];
  const base = Array.from(name.toLowerCase().trim())
    .map((c) => (alphabet.includes(c) ? letters[alphabet.indexOf(c)] : c))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 74)
    .replace(/-+$/g, '');
  if (!base) return name.trim() ? 'tovar' : '';
  let slug = base,
    suffix = 2;
  while (products.some((p) => p.slug === slug)) slug = base + '-' + suffix++;
  return slug;
}
