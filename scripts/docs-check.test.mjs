import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkDocs, parseDocument } from './docs-check.mjs';

function fixture(t, files, omit = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-docs-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documents = [];
  for (const [name, body] of Object.entries(files)) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, `Statut documentaire : actif.\n\n${body}`);
    if (!omit.includes(name))
      documents.push({
        path: name,
        status: 'actif',
        role: 'guide',
        audience: 'test',
        review: 'relue',
        action: 'conservé',
        informationUnique: ['Contenu du scénario'],
        references: [],
      });
  }
  return { root, inventory: { documents } };
}
test('ancres accentuées, doublons, collisions et ancres HTML', () => {
  const doc = parseDocument(
    '# État\n## État\n## État-1\n<a id="explicite"></a>',
  );
  assert.deepEqual(
    [...doc.anchors],
    ['état', 'état-1', 'état-1-1', 'explicite'],
  );
});
test('liens Markdown réels : références, images, espaces et parenthèses ; code ignoré', () => {
  const doc = parseDocument(
    '[test][id]\n\n[id]: guide.md#état\n\n![image](<capture avec espace.png>)\n[lien](a(b).md)\n`[faux](inexistant.md)`\n```md\n[faux](autre.md)\n```',
  );
  assert.deepEqual(
    doc.links.map((l) => l.url),
    ['guide.md#état', 'capture avec espace.png', 'a(b).md'],
  );
});
test('déplacement relatif et ancre percent-encodée valides', (t) => {
  const { root, inventory } = fixture(t, {
    'README.md': '[guide](docs/archive/guide.md#%C3%A9tat)',
    'docs/archive/guide.md': '# État\n[retour](../../README.md)',
  });
  assert.deepEqual(checkDocs(root, inventory).errors, []);
});
test('cible, ancre et casse incorrectes échouent même sous Windows', (t) => {
  const { root, inventory } = fixture(t, {
    'README.md':
      '[absent](absent.md)\n[ancre](guide.md#absente)\n[casse](Guide.md)',
    'guide.md': '# État',
  });
  const errors = checkDocs(root, inventory).errors;
  assert.equal(errors.length, 3);
  assert.ok(errors.some((x) => x.includes('ancre absente')));
});
test('document non classé, disparu, doublon et statut incohérent sont refusés', (t) => {
  const { root, inventory } = fixture(
    t,
    { 'README.md': '# Guide', 'nouveau.md': '# Nouveau' },
    ['nouveau.md'],
  );
  inventory.documents[0].status = 'archive';
  delete inventory.documents[0].informationUnique;
  inventory.documents.push(
    { ...inventory.documents[0] },
    { ...inventory.documents[0], path: 'supprime.md' },
  );
  const errors = checkDocs(root, inventory).errors.join('\n');
  for (const expected of [
    'non classé',
    'fichier absent',
    'doublon',
    'statut incohérent',
    'inventaire incomplet',
  ])
    assert.ok(errors.includes(expected));
});
test('sorties générées ignorées ; sortie du dépôt refusée ; lien externe hors réseau', (t) => {
  const { root, inventory } = fixture(t, {
    'README.md': '[externe](https://example.com)\n[sortie](../secret.md)',
  });
  fs.mkdirSync(path.join(root, '.verification'));
  fs.writeFileSync(path.join(root, '.verification/generated.md'), '# Ignoré');
  const result = checkDocs(root, inventory);
  assert.equal(result.documentCount, 1);
  assert.equal(result.errors.length, 1);
});
test('index humain et lien depuis l’index principal sont contrôlés', (t) => {
  const { root, inventory } = fixture(t, {
    'docs/README.md': '# Index',
    'docs/reference/inventaire-documentaire.md': '# Inventaire',
  });
  const errors = checkDocs(root, inventory).errors.join('\n');
  assert.ok(errors.includes('inventaire lisible non lié'));
  assert.ok(errors.includes('lien absent'));
});
