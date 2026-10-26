import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, '..', 'src', 'contexts', 'LanguageContext.tsx');
const srcDir = resolve(currentDir, '..', 'src');
const source = readFileSync(sourcePath, 'utf8');
const languages = ['en', 'id', 'zh'];

function translationKeys(language, nextLanguage) {
  const startMarker = `  ${language}: {`;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing ${language} translation dictionary`);

  const end = nextLanguage
    ? source.indexOf(`  ${nextLanguage}: {`, start + startMarker.length)
    : (() => {
        const relativeEnd = source.slice(start + startMarker.length).search(/\r?\n  },\r?\n};/);
        return relativeEnd < 0 ? -1 : start + startMarker.length + relativeEnd;
      })();
  if (end < 0) throw new Error(`Cannot find the end of the ${language} dictionary`);

  const block = source.slice(start, end);
  return [...block.matchAll(/^\s*'([^']+)'\s*:/gm)].map((match) => match[1]);
}

const dictionaries = Object.fromEntries(
  languages.map((language, index) => [
    language,
    translationKeys(language, languages[index + 1]),
  ]),
);

let failed = false;
for (const language of languages) {
  const keys = dictionaries[language];
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    failed = true;
    console.error(`${language}: duplicate keys: ${[...new Set(duplicates)].join(', ')}`);
  }
}

const reference = new Set(dictionaries.en);
for (const language of languages.slice(1)) {
  const candidate = new Set(dictionaries[language]);
  const missing = [...reference].filter((key) => !candidate.has(key));
  const extra = [...candidate].filter((key) => !reference.has(key));

  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    if (missing.length > 0) console.error(`${language}: missing keys: ${missing.join(', ')}`);
    if (extra.length > 0) console.error(`${language}: extra keys: ${extra.join(', ')}`);
  }
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.tsx?$/.test(entry.name) ? [fullPath] : [];
  });
}

const usedKeys = new Map();
for (const file of sourceFiles(srcDir)) {
  const contents = readFileSync(file, 'utf8');
  for (const match of contents.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const key = match[1];
    if (!usedKeys.has(key)) usedKeys.set(key, []);
    usedKeys.get(key).push(file);
  }
}

const undefinedKeys = [...usedKeys.keys()].filter((key) => !reference.has(key));
if (undefinedKeys.length > 0) {
  failed = true;
  for (const key of undefinedKeys) {
    console.error(`Undefined translation key ${key}: ${usedKeys.get(key).join(', ')}`);
  }
}

if (failed) process.exit(1);

console.log(
  `Translation dictionaries are aligned: ${languages
    .map((language) => `${language}=${dictionaries[language].length}`)
    .join(', ')}; literal keys used=${usedKeys.size}`,
);
