import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  captureSummarySchema, eventSchema, httpSchema, manifestSchema, oracleSchema, postgresSchema
} from '../dist/packages/schema/src/index.js';
import { resultSchema } from '../dist/packages/replay/src/result.js';

const schemas = {
  manifest: manifestSchema, event: eventSchema, assertions: oracleSchema, http: httpSchema,
  postgres: postgresSchema, 'capture-summary': captureSummarySchema, 'worker-result': resultSchema
};

for (const [name, schema] of Object.entries(schemas)) {
  const target = new URL('../docs/format/' + name + '.schema.json', import.meta.url);
  const contents = JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== contents) throw new Error('Generated schema differs for ' + name);
  } else {
    await writeFile(target, contents);
  }
}
