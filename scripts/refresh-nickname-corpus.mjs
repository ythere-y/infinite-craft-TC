import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshNicknameCorpus } from "./nickname-data-lib.mjs";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await refreshNicknameCorpus();
  process.stdout.write(
    `Refreshed ${result.output} (${result.chengyu} chengyu, ${result.states} states)\n`,
  );
}
