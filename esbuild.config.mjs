import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "ES2020",
  outfile: "main.js",
  external: ["obsidian", "electron"],
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  logLevel: "info",
  platform: "node",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
  process.exit(0);
} else {
  await ctx.watch();
  console.log("Watching for changes...");
}
