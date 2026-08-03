import { validateCommittedIconAssets } from "./icon-data-lib.mjs";

validateCommittedIconAssets()
  .then((summary) => {
    console.log(
      `Verified ${summary.emojiFiles} emoji PNGs, ${summary.emojiEntries} manifest entries, ${summary.actionIcons} action SVGs, and ${summary.elementEntries} element mappings.`,
    );
  })
  .catch((error) => {
    console.error(`Icon asset verification failed: ${error.message}`);
    process.exitCode = 1;
  });
