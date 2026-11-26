import { constants } from 'node:fs';
import { open, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { digest, json, recipeId, sha256 } from '../../schema/src/index.js';

const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const variant = z.enum(['bad', 'fixed']);
const schema = z.strictObject({
  recipe: z.literal(recipeId), image, variant, source_revision: digest, recipe_revision: digest
});
export type Recipe = z.infer<typeof schema>;

export function parseRecipe(text: string): Recipe {
  const document = parseDocument(text, { schema: 'core', uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) throw new Error('Invalid recipe YAML');
  return schema.parse(document.toJS({ maxAliasCount: 0 }));
}

export async function loadRecipe(project: string): Promise<Recipe> {
  const file = resolve(await realpath(project), 'repro.config.yaml');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (stat.size > 4096 || !stat.isFile()) throw new Error('Invalid recipe file');
    const text = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(text, 0, text.length, 0);
    if (bytesRead > 4096) throw new Error('Invalid recipe size');
    return parseRecipe(new TextDecoder('utf-8', { fatal: true }).decode(text.subarray(0, bytesRead)));
  } finally {
    await handle.close();
  }
}

export async function initRecipe(project: string, candidate?: { image: string; variant: string; source_revision: string; recipe_revision: string }) {
  const file = resolve(await realpath(project), 'repro.config.yaml');
  const content = candidate
    ? stringify(schema.parse({ recipe: recipeId, ...candidate }))
    : '# Replace the placeholders after preparing and reviewing the checkout image.\n' +
      'recipe: checkout-v1\nimage: <local image ID>\nvariant: bad\nsource_revision: <variant source digest>\nrecipe_revision: <runner contract digest>\n';
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
  return file;
}

export function recipeDigest(recipe: Recipe): string {
  return sha256(json({ recipe: recipe.recipe, contract: recipe.recipe_revision, network: 'none', runner: 1 }));
}
