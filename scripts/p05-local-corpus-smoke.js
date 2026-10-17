'use strict';
const fs = require('node:fs/promises');
const { createDriveCorpusStore } = require('../modules/context-store/src/drive-corpus-store');
const { createLocalCorpusObjectTransport } = require('../modules/context-store/src/local-corpus-transport');

async function main(args) {
  if (args.length !== 4 || !['--fixture', '--root'].includes(args[0])
      || !['--fixture', '--root'].includes(args[2]) || args[0] === args[2]
      || !args[1] || !args[3]) throw new Error('P05_SMOKE_ARGUMENTS_INVALID');
  const options = { [args[0]]: args[1], [args[2]]: args[3] };
  const input = JSON.parse(await fs.readFile(options['--fixture'], 'utf8'));
  const first = createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root:options['--root']})});
  const receipt = await first.putCorpusProjection(input);
  const reopened = createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root:options['--root']})});
  const result = await reopened.readCorpusProjection({scope:receipt.scope,corpus_manifest_ref:receipt.corpus_manifest_ref});
  const original = new Map(input.documents.map(x=>[x.source_ref,x]));
  if (result.documents.length !== original.size || result.documents.some(x=>
    original.get(x.source_ref)?.content !== x.content || original.get(x.source_ref)?.path !== x.path)) {
    throw new Error('P05_SMOKE_INTEGRITY_FAILED');
  }
  process.stdout.write(JSON.stringify({
    status:'verified_offline',scope:receipt.scope,corpus_manifest_ref:receipt.corpus_manifest_ref,
    document_count:result.documents.length,source_revision:result.manifest.source_revision,
    drive_authenticated:false,p05_runtime_qualified:false,
  })+'\n');
}

if (require.main === module) main(process.argv.slice(2)).catch(error=>{
  const label=error.message==='P05_SMOKE_ARGUMENTS_INVALID'?'P05_SMOKE_ARGUMENTS_INVALID':'P05_SMOKE_FAILED';
  process.stderr.write(label+'\n');process.exitCode=1;
});
module.exports = {main};
