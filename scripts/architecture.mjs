import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

export function runtimeSpecifiers(source, filename = 'module.ts') {
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      if (!onlyTypes) result.add(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      !node.isTypeOnly
    ) {
      const clause = node.exportClause;
      if (
        !clause ||
        !ts.isNamedExports(clause) ||
        clause.elements.length === 0 ||
        clause.elements.some((item) => !item.isTypeOnly)
      )
        result.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      result.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return [...result];
}

export function findCycles(graph) {
  const done = new Set(),
    active = new Set(),
    stack = [],
    cycles = [];
  function visit(file) {
    if (active.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file]);
      return;
    }
    if (done.has(file)) return;
    active.add(file);
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}

function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(filename)
      : /\.(ts|tsx)$/.test(filename) && !/\.(test|spec|d)\.tsx?$/.test(filename)
        ? [fs.realpathSync(filename)]
        : [];
  });
}

export function auditArchitecture(root) {
  const files = ['apps', 'packages'].flatMap((folder) =>
    fs.readdirSync(path.join(root, folder)).flatMap((name) => {
      const src = path.join(root, folder, name, 'src');
      return fs.existsSync(src) ? sources(src) : [];
    }),
  );
  const known = new Set(files),
    graph = new Map(),
    failures = [];
  const options = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.ReactJSX,
  };
  const relative = (filename) =>
    path.relative(root, filename).replaceAll('\\', '/');
  for (const file of files) {
    const edges = [];
    for (const spec of runtimeSpecifiers(fs.readFileSync(file, 'utf8'), file)) {
      const resolved = ts.resolveModuleName(
        spec,
        file,
        options,
        ts.sys,
      ).resolvedModule;
      if (!resolved) {
        if (
          (spec.startsWith('.') && /\.(js|ts|tsx)$/.test(spec)) ||
          spec.startsWith('@friday/')
        )
          failures.push(
            `Unresolved runtime import: ${relative(file)} -> ${spec}`,
          );
        continue;
      }
      const target = fs.realpathSync(resolved.resolvedFileName);
      if (!known.has(target)) continue;
      edges.push(target);
      const from = relative(file),
        to = relative(target);
      if (
        from.startsWith('apps/hub/src/inference/') &&
        !to.startsWith('apps/hub/src/inference/') &&
        to.startsWith('apps/hub/')
      )
        failures.push(
          `Inference must remain independent of Hub domains: ${from} -> ${to}`,
        );
      if (
        /apps\/web\/src\/db\/(device-context|outbox-repository)\.ts$/.test(
          from,
        ) &&
        to.startsWith('apps/web/') &&
        !to.startsWith('apps/web/src/db/') &&
        !to.startsWith('apps/web/src/crypto/')
      )
        failures.push(
          `Local storage foundation depends on UI or transport: ${from} -> ${to}`,
        );
      if (
        from === 'apps/web/src/db/sync-repository.ts' &&
        to === 'apps/web/src/db/task-repository.ts'
      )
        failures.push(
          'Synchronization must not depend on the task repository.',
        );
    }
    graph.set(file, edges);
  }
  for (const cycle of findCycles(graph))
    failures.push(`Runtime cycle: ${cycle.map(relative).join(' -> ')}`);
  return {
    modules: files.length,
    edges: [...graph.values()].reduce((sum, values) => sum + values.length, 0),
    failures,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = auditArchitecture(
    path.resolve(fileURLToPath(new URL('..', import.meta.url))),
  );
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.failures.length) process.exitCode = 1;
}
