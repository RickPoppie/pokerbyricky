import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = "dist-pages";
const clientDirectory = "dist/client";
const workerDirectory = "dist/server";

async function copyDirectoryContents(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
    });
  }
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await copyDirectoryContents(clientDirectory, outputDirectory);
await cp(workerDirectory, join(outputDirectory, "_worker"), { recursive: true });
await writeFile(
  join(outputDirectory, "_worker.js"),
  'export { default } from "./_worker/index.js";\n'
);
