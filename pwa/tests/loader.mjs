// Node module hooks for the unit tests. No dependencies beyond what the app already has:
//   - `$lib/*` -> src/lib/*, `$env/static/public` -> a stub
//   - extensionless imports resolve to .ts / .svelte.ts (as Vite does)
//   - .ts is type-stripped with node:module; .svelte.ts additionally goes through svelte's compileModule
//     so the REAL rune stores ($state, class fields) run, not a re-implementation of them.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { compileModule } from 'svelte/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const libDir = pathResolve(here, '../src/lib');
const SUFFIXES = ['', '.ts', '.svelte.ts', '/index.ts'];

function probe(base) {
	for (const s of SUFFIXES) {
		const p = base + s;
		if (existsSync(p) && statSync(p).isFile()) return p;
	}
	return null;
}

export async function resolve(specifier, context, next) {
	if (specifier === '$env/static/public') {
		return { url: pathToFileURL(pathResolve(here, 'env-stub.mjs')).href, shortCircuit: true };
	}
	let base = null;
	if (specifier.startsWith('$lib/')) base = pathResolve(libDir, specifier.slice(5));
	else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
		base = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier);
	}
	if (base) {
		const hit = probe(base);
		if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
	}
	return next(specifier, context);
}

export async function load(url, context, next) {
	if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context);
	const file = fileURLToPath(url);
	let code = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' });
	if (file.endsWith('.svelte.ts')) {
		code = compileModule(code, { generate: 'client', filename: file, dev: false }).js.code;
	}
	return { format: 'module', source: code, shortCircuit: true };
}
