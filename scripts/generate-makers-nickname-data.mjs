import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateMakersNicknameData } from "./nickname-data-lib.mjs";

export { generateMakersNicknameData } from "./nickname-data-lib.mjs";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateMakersNicknameData();
  process.stdout.write(
    `Generated ${result.output} (${result.chengyu} chengyu, ${result.states} states)\n`,
  );
}
