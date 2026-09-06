import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const ignored = new Set([
  '.git',
  '.analysis',
  '.verification',
  '.codex-remote-attachments',
  'node_modules',
  'dist',
  'coverage',
  'output',
  'tmp',
  'test-results',
  'playwright-report',
  '.playwright-cli',
  '__pycache__',
  '.pytest_cache',
]);
const statuses = new Set([
  'actif',
  'archive',
  'recette',
  'vision',
  'plan',
  'reference',
  'redirection',
]);
export function documentFiles(root, directory = root) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return documentFiles(root, filename);
      const rel = path.relative(root, filename).split(path.sep).join('/');
      return /\.(md|docx)$/i.test(entry.name) ||
        entry.name.endsWith('.env.example') ||
        entry.name === '.env.example'
        ? [rel]
        : [];
    })
    .sort();
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
function nodeText(node) {
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'html') return '';
  return node.value ?? (node.children ?? []).map(nodeText).join('');
}
export function parseDocument(source) {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const anchors = new Set(),
    links = [],
    definitions = new Map(),
    missing = [];
  walk(tree, (node) => {
    if (node.type === 'definition') definitions.set(node.identifier, node.url);
    if (node.type === 'heading') {
      const base = nodeText(node)
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '')
        .replace(/\s/g, '-');
      let slug = base,
        index = 0;
      while (anchors.has(slug)) slug = `${base}-${++index}`;
      anchors.add(slug);
    }
    if (node.type === 'html') {
      for (const m of node.value.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
        anchors.add(m[1]);
      for (const m of node.value.matchAll(/\b(?:href|src)=["']([^"']+)["']/g))
        links.push({ url: m[1], line: node.position.start.line });
    }
  });
  walk(tree, (node) => {
    if (node.type === 'link' || node.type === 'image')
      links.push({ url: node.url, line: node.position.start.line });
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const url = definitions.get(node.identifier);
      if (url !== undefined)
        links.push({ url, line: node.position.start.line });
      else missing.push(`référence absente : ${node.identifier}`);
    }
  });
  return { anchors, links, missing };
}

function exactPath(root, relative) {
  let current = root;
  for (const part of relative.split('/').filter(Boolean)) {
    if (!fs.existsSync(current) || !fs.statSync(current).isDirectory())
      return false;
    if (!fs.readdirSync(current).includes(part)) return false;
    current = path.join(current, part);
  }
  return fs.existsSync(current);
}

export function checkDocs(root, inventory) {
  const errors = [],
    actual = documentFiles(root),
    parsed = new Map();
  const rows = new Map();
  for (const row of inventory.documents ?? []) {
    if (rows.has(row.path)) errors.push(`inventaire : doublon ${row.path}`);
    rows.set(row.path, row);
    if (
      !statuses.has(row.status) ||
      !row.role ||
      !row.audience ||
      !row.review ||
      !row.action ||
      !row.informationUnique?.length ||
      !Array.isArray(row.references)
    )
      errors.push(`inventaire incomplet : ${row.path}`);
    if (!actual.includes(row.path))
      errors.push(`inventaire : fichier absent ${row.path}`);
  }
  let linkCount = 0;
  for (const file of actual) {
    const row = rows.get(file);
    if (!row) errors.push(`document non classé : ${file}`);
    if (!file.endsWith('.md')) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const status = source.match(/^Statut documentaire : ([a-z]+)\./m)?.[1];
    if (status !== row?.status || !status)
      errors.push(`statut incohérent : ${file}`);
    const doc = parseDocument(source);
    parsed.set(file, doc);
    for (const missing of doc.missing) errors.push(`${file} : ${missing}`);
  }
  for (const [file, doc] of parsed) {
    for (const link of doc.links) {
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(link.url)) continue;
      linkCount++;
      const [raw, ...fragments] = link.url.split('#');
      let relative, anchor;
      try {
        relative = raw ? decodeURIComponent(raw.split('?')[0]) : '';
        anchor = decodeURIComponent(fragments.join('#'));
      } catch {
        errors.push(`${file}:${link.line} URL invalide : ${link.url}`);
        continue;
      }
      const target = relative.startsWith('/')
        ? path.posix.normalize(relative.slice(1))
        : relative
          ? path.posix.normalize(
              path.posix.join(path.posix.dirname(file), relative),
            )
          : file;
      if (
        target.startsWith('../') ||
        path.posix.isAbsolute(target) ||
        !exactPath(root, target)
      ) {
        errors.push(
          `${file}:${link.line} cible absente ou casse incorrecte : ${link.url}`,
        );
        continue;
      }
      if (anchor && target.endsWith('.md')) {
        const targetDoc =
          parsed.get(target) ??
          parseDocument(fs.readFileSync(path.join(root, target), 'utf8'));
        if (!targetDoc.anchors.has(anchor))
          errors.push(`${file}:${link.line} ancre absente : ${link.url}`);
      }
    }
  }
  const index = parsed.get('docs/README.md');
  if (
    index &&
    !index.links.some((l) => l.url === 'reference/inventaire-documentaire.md')
  )
    errors.push('index : inventaire lisible non lié');
  const humanIndex = parsed.get('docs/reference/inventaire-documentaire.md');
  if (humanIndex) {
    const indexed = new Set(
      humanIndex.links
        .filter((l) => !/^[a-z]+:/i.test(l.url))
        .map((l) =>
          path.posix.normalize(
            path.posix.join(
              'docs/reference',
              decodeURIComponent(l.url.split('#')[0]),
            ),
          ),
        ),
    );
    for (const file of actual)
      if (!indexed.has(file))
        errors.push(`inventaire lisible : lien absent ${file}`);
  }
  return { errors, documentCount: actual.length, linkCount };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const root = process.cwd();
  const inventory = JSON.parse(
    fs.readFileSync(
      path.join(root, 'docs/reference/inventaire-documentaire.json'),
      'utf8',
    ),
  );
  const result = checkDocs(root, inventory);
  for (const error of result.errors) process.stderr.write(`${error}\n`);
  process.stdout.write(
    `${result.documentCount} documents ; ${result.linkCount} liens internes ; ${result.errors.length} erreurs\n`,
  );
  if (result.errors.length) process.exitCode = 1;
}
