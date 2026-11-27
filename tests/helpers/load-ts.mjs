import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);
export function loadTs(file, mocks = {}, globals = {}) {
  const exports = {};
  const require = name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, process, console, Buffer, URL, URLSearchParams, Uint8Array,
    TextEncoder, TextDecoder, AbortController, Response, Request, setTimeout, clearTimeout, ...globals }, { filename: file });
  return exports;
}
